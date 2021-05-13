//
//
// Unnode.js - A Node.js back end framework
//
// https://unnodejs.org
//
// Copyright (c) 2020, 2021 RicForge - https://ricforge.com
//
// RicForge is a Nurminen Development Oy Ltd organization - https://nurminen.dev
//
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
// DEALINGS IN THE SOFTWARE.
//
//


'use strict'

import path                 from 'node:path'
import cluster              from 'node:cluster'
import chalk                from 'chalk'

import { masterLogger }     from './logger.js'
import * as utils           from './utils.js'


class UnnodeMaster {
    _firstInitDone          = false
    _numWorkers             = 0
    _numWorkersReady        = 0
    _webpackDevMiddleware   = null


    constructor() {
        process.title = 'unnode-master'
    }


    async init(serverDir) {
        masterLogger.init(serverDir)

        const cpuCount = (await import('node:os')).cpus().length

        let workers = process.env.UNNODE_WORKERS

        // UNNODE_WORKERS must be >=1 and <= CPU count, else default to CPU count
        if (isNaN(workers) || workers < 1 || workers > cpuCount) {
            workers = cpuCount
        }

        this._numWorkers = parseInt(workers)

        masterLogger.log('info', `Detected ${cpuCount} CPUs, using ${workers}`)
        masterLogger.log('info', '')

        cluster.on('online',     this._workerOnline.bind(this))
        cluster.on('message',    this._messageFromWorker.bind(this))
        cluster.on('disconnect', this._workerDisconnect.bind(this))
        cluster.on('exit',       this._workerExit.bind(this))

        const shutdownSignals = ['SIGINT', 'SIGTERM']

        let shutdownSignalReceived = false

        shutdownSignals.forEach(signal => {
            process.on(signal, () => {
                if(shutdownSignalReceived === false) {
                    shutdownSignalReceived = true
                    masterLogger.log('info', `Received ${signal}, shutting down workers`)
                    this._shutdownWorkers()
                }
            })
        })

        // SIGUSR2: Restart all workers / code hot-reload
        process.on('SIGUSR2', () => {
            // _restartWorkers() immediately sets this._firstInitDone = false
            // so use that as a spam-protection flag
            if(this._firstInitDone === true) {
                masterLogger.log('info', 'Received SIGUSR2, restarting workers')
                this._restartWorkers()
            }
        })

        await this._startWebpackWatcher(serverDir)

        // Fire up workers
        for (let i = 0; i < workers; i++) {
            cluster.fork()
        }

    }



    /********************************************************************
    *********************************************************************

     ██████╗██╗     ██╗   ██╗███████╗████████╗███████╗██████╗ 
    ██╔════╝██║     ██║   ██║██╔════╝╚══██╔══╝██╔════╝██╔══██╗
    ██║     ██║     ██║   ██║███████╗   ██║   █████╗  ██████╔╝
    ██║     ██║     ██║   ██║╚════██║   ██║   ██╔══╝  ██╔══██╗
    ╚██████╗███████╗╚██████╔╝███████║   ██║   ███████╗██║  ██║
     ╚═════╝╚══════╝ ╚═════╝ ╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝

    *********************************************************************
    ********************************************************************/

    _workerOnline(worker) {
        masterLogger.log('info', 'Worker process ' + chalk.bgRed(`[${worker.process.pid}]`) + ' online')
    }


    _workerDisconnect(worker) {
        masterLogger.log('debug', chalk.bgRed(`[${worker.process.pid}]`) + ' IPC channel disconnected.')
    }


    async _workerExit(worker, code, signal) {
        if(code === 0 || !this._firstInitDone || signal === 'SIGTERM' || signal === 'SIGINT') {
            // Normal worker process, crash during startup, or SIGINT/TERM = no restart
            masterLogger.log(
                'info',
                'Worker process ' + chalk.bgRed(`[${worker.process.pid}]`)
                    + ` exited (code: ${code}, signal: ${signal})`
            )
            if(Object.entries(cluster.workers).length === 0) {
                // Close webpack watcher
                await this._closeWebpackWatcher()
            }
        } else {
            // Abnormal exit, restart worker
            masterLogger.log(
                'alert',
                'Worker process ' + chalk.bgRed(`[${worker.process.pid}]`)
                    + ` died abnormally (code: ${code}, signal: ${signal}), forking new...`)
            cluster.fork()
        }
    }


    _messageFromWorker(worker, message) {
        if (!utils.isObject(message)) {
            return
        }

        switch (message.type) {
            case 'log':
                masterLogger.log(message.level, message.message, message.overrideRollbar)
                break
            case 'shutdown':
                worker.disconnect()
                break
            case 'serverRunning':
                if (!this._firstInitDone) {
                    this._numWorkersReady++

                    if (this._numWorkersReady === this._numWorkers) {
                        masterLogger.log('info', '')
                        masterLogger.log('info', `All workers online (${this._numWorkers})`)
                        if (message.listen_port_insecure !== null) {
                            masterLogger.log('info', `Express server listening on ${message.listen_host}:${message.listen_port_insecure} (HTTP)`)
                        }
                        if (message.listen_port_secure !== null) {
                            masterLogger.log('info', `Express server listening on ${message.listen_host}:${message.listen_port_secure} (HTTPS)`)
                        }
                        masterLogger.log('info', '')

                        this._firstInitDone = true
                    }
                }
            case 'pingConsole':
                const pingIfNoActivityInSeconds = (60 * 60) * 2
                masterLogger.pingConsole(pingIfNoActivityInSeconds)
                break
            default:
                break

        }
    }


    _shutdownWorkers() {
        for (const id in cluster.workers) {
            // Send a shutdown request to worker, worker will then gracefully close down
            // and request a disconnect
            cluster.workers[id].send('shutdown')
        }
    }


    _restartWorkers() {
        this._numWorkersReady   = 0
        this._firstInitDone     = false

        let wid
        const workerIds = []

        for (wid in cluster.workers) {
            workerIds.push(wid)
        }

        workerIds.forEach((wid) => {
            cluster.workers[wid].send('shutdown')

            // Forcefully kill a process after a certain time if it hasn't
            // gracefully exited
            setTimeout(() => {
                if (cluster.workers[wid]) {
                    cluster.workers[wid].kill('SIGKILL')
                }
            }, 6000) // Make sure this is higher than http-terminator grace perioid
                     // in worker.js

            // We can already spawn new processes while the old ones are exiting
            cluster.fork()
        })
    }



    /********************************************************************
    *********************************************************************

    ██╗    ██╗███████╗██████╗ ██████╗  █████╗  ██████╗██╗  ██╗
    ██║    ██║██╔════╝██╔══██╗██╔══██╗██╔══██╗██╔════╝██║ ██╔╝
    ██║ █╗ ██║█████╗  ██████╔╝██████╔╝███████║██║     █████╔╝
    ██║███╗██║██╔══╝  ██╔══██╗██╔═══╝ ██╔══██║██║     ██╔═██╗
    ╚███╔███╔╝███████╗██████╔╝██║     ██║  ██║╚██████╗██║  ██╗
     ╚══╝╚══╝ ╚══════╝╚═════╝ ╚═╝     ╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝

    *********************************************************************
    ********************************************************************/

    async _startWebpackWatcher(serverDir) {
        if(process.env.NODE_ENV !== 'production') {
            const webpackConfigPath     = process.env.UNNODE_WEBPACK_DEV_CONFIG
            let webpackConfigFullPath   = null
    
            if(typeof webpackConfigPath === 'string' && webpackConfigPath.length > 0) {
                webpackConfigFullPath = path.join(serverDir, 'config', webpackConfigPath)
            }

            if(webpackConfigFullPath === null) {
                return true
            }

            const isWebpackConfigReadable = utils.isFileReadableSync(webpackConfigFullPath)
    
            if(webpackConfigFullPath !== null && isWebpackConfigReadable === false) {
                throw new Error(`UNNODE_WEBPACK_DEV_CONFIG is not readable: ${webpackConfigFullPath}`)
            }
    
            const webpack               = (await import('webpack')).default
            const webpackDevMiddleware  = (await import('webpack-dev-middleware')).default
            const webpackConfig         = (await import(webpackConfigFullPath)).default

            const webpackCompiler = webpack(webpackConfig)

            this._webpackDevMiddleware = webpackDevMiddleware(webpackCompiler, {
                publicPath: webpackConfig.output.publicPath,
                writeToDisk: true
            })

            await new Promise((resolve, reject) => {
                this._webpackDevMiddleware.waitUntilValid(() => {
                    resolve()
                })
            })

            return true
        } else {
            resolve(true)
        }
    }


    _closeWebpackWatcher() {{
        return new Promise((resolve) => {
            if(this._webpackDevMiddleware === null) {
                return resolve()
            }
            this._webpackDevMiddleware.close(() => {
                this._webpackDevMiddleware = null
                masterLogger.log('debug', 'webpack-dev-middleware closed.')
                resolve()
            })
        })
    }}

}


export default new UnnodeMaster()
