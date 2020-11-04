//
//
// Unnode.js - A Node.js back end framework
//
// https://www.unnodejs.org
//
// Copyright (c) 2020 RicForge - https://www.ricforge.com
//
// RicForge is a Nurminen Development organization - https://www.nurminen.dev
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

const path              = require('path')
const tls               = require('tls')
const http              = require('http')
const https             = require('https')
const httpTerminator    = require('http-terminator')
const express           = require('express')
const helmet            = require('helmet')
const chalk             = require('chalk')

const logger            = require('./logger.js').workerLogger
const utils             = require('./utils.js')
const { handle }        = require('./utils.js')

const vhostRouter       = require('../backends/express-vhost-router.js')


class UnnodeWorker {
    _serverConfig           = null

    _serverApp              = null

    _webpackCompiler        = null
    _webpackDevMiddleware   = null

    _serverQuitting         = false
    _shutdownCallback       = null

    _serverInsecure         = null
    _serverSecure           = null
    _httpTerminator         = null
    _httpsTerminator        = null

    _pingInterval           = null


    constructor() {
        process.title = `unnode-worker (pid: ${process.pid})`

        process.on('SIGTERM', () => { })
        process.on('SIGINT', () => { })
        process.on('SIGUSR2', () => { })

        process.on('message', (message) => {
            if(message === 'shutdown') {
                this.shutdownServer()
            }
        })
    }


    getServerApp() { return this._serverApp }

    registerShutdownCallback(shutdownCallback) {{
        if(typeof shutdownCallback === 'function') {
            this._shutdownCallback = shutdownCallback
        }
    }}


    async setupServer(serverDir) {
        this._serverApp = express()

        this._serverApp.use(vhostRouter.middleware())

        const defaultConfigPath = path.join(serverDir, 'config', 'unnode-server-config.js')

        const configPath = process.env.UNNODE_SERVER_CONFIG || defaultConfigPath

        // Parse server config, vhosts, routes etc
        this._serverConfig = this._parseServerConfig(configPath)

        this._serverConfig.forEach((config) => {
            this._setupServerVhost(config, serverDir)
        })

        this._pingInterval = setInterval(() => {
            process.send({ 'type': 'pingConsole' })
        }, 60000)

        return true
    }


    _setupServerVhost(config, serverDir) {
        const vhosts = config.vhost
        const routes = config.routes

        let isCatchAllVhost = false

        let vhostApp = this._serverApp

        if(vhosts.length === 1 && vhosts[0] === '*') {
            isCatchAllVhost = true
        } else {
            vhostApp = express()
            vhostApp.use(helmet())
        }

        if(config.viewEngine) {
            vhostApp.set('view engine', config.viewEngine)
        }

        if(config.viewsPath) {
            vhostApp.set('views', config.viewsPath)
        }

        routes.forEach((route) => {
            const routeMethod   = route.method
            const routePath     = route.path
            const routeStatic   = route.static

            // If this isn't a static route, then we must have a controller
            const routeModule   = routeStatic ? null : route.controller.substr(0, route.controller.indexOf('#'))
            const routeHandler  = routeStatic ? null : route.controller.substring(route.controller.lastIndexOf('#') + 1)

            const routeCustomParameter = route.customParameter || null


            if(routeStatic) {
                vhostApp.use(routePath, express.static(routeStatic))

                logger.log('debug', `UnnodeWorker#setupServer: Added ${routeMethod} ${vhosts.join(',')} ${routePath}, static file serve`)
            } else {
                try {
                    const routeHandlerObject = require(path.join(serverDir, 'controllers', `${routeModule}.js`))
                    vhostApp[routeMethod.toLowerCase()](routePath, routeHandlerObject[routeHandler].bind(routeHandlerObject, routeCustomParameter))
                    logger.log('debug', `UnnodeWorker#setupServer: Added ${routeMethod} ${vhosts.join(',')} ${routePath}, controller: ${route.controller}`)
                } catch(e) {
                    logger.log('error', `UnnodeWorker#setupServer: Failed to add route ${routeMethod} ${vhosts.join(',')} ${routePath}, controller: ${route.controller}: ${e.message}`)
                    throw new Error(`Errors while setting up routes from Unnode.js server config file, exiting.`)
                }

            }
        })

        if(!isCatchAllVhost) {
            vhosts.map((vhost) => {{
                vhostRouter.register(vhost, vhostApp)
            }})
        }
    }


    getWebBackend(host) {
        return vhostRouter.getApp(host)
    }


    addWildcardRoute() {
        // Default endpoint for everything else
        this._serverApp.use((req, res) => {
            const ip     = utils.getClientIp(req)
            const method = req.method
            const url    = utils.getRequestFullUrl(req)
            const agent  = req.get('user-agent')

            logger.log('notice', `Wildcard request ${method} ${url} (from: ${ip}, User-Agent: ${agent})`, 'no-rollbar')

            // Set shortcut icon to empty so browsers stop requesting it
            res.status(404).send('<html><head><title>404 Not Found</title><link rel="shortcut icon" href="data:image/x-icon;," type="image/x-icon"></head><body><h1>404 Not Found</h1></body></html>')
        })

        logger.log('debug', `UnnodeWorker#addWildCardRoute: Added wildcard route handler (404 reply + request logging)`)
    }


    async runServer() {
        // Default to listening on all interfaces if not set in ENV
        const listenHost    = process.env.UNNODE_SERVER_LISTEN_HOST || '0.0.0.0'
        const portInsecure  = process.env.UNNODE_SERVER_INSECURE_PORT
        const portSecure    = process.env.UNNODE_SERVER_SECURE_PORT

        if(portInsecure && !isNaN(portInsecure)) {
            await this._startHttpServer(listenHost, portInsecure)
        } else {
            logger.log('debug', 'UNNODE_SERVER_INSECURE_PORT not set or not a valid port number, skipping nonsecure HTTP server start.')
        }

        if(portSecure && !isNaN(portSecure)) {
            await this._startHttpSecureServer(listenHost, portSecure)
        }

        if(this._serverInsecure === null && this._serverSecure === null) {
            logger.log('emerg', 'Neither HTTP nor HTTPS server was able to start, exiting...')
            return await this.shutdownServer()
        }

        process.send({
            'type': 'serverRunning',
            'listen_host': listenHost,
            'listen_port_insecure': (this._serverInsecure !== null) ? portInsecure : null,
            'listen_port_secure': (this._serverSecure !== null) ? portSecure : null
        })

        return true
    }


    _startHttpServer(listenHost, portInsecure) {
        return new Promise((resolve, reject) => {
            this._serverInsecure = http.createServer(this._serverApp)
            this._serverInsecure.on('error', this._handleHttpServerError.bind(this))
            this._serverInsecure.on('clientError', this._handleHttpClientError.bind(this))
            this._serverInsecure.on('close', () => {
                logger.log('debug', chalk.bgBlue('[Express] HTTP Server closed'))
            })
            this._serverInsecure.listen(portInsecure, listenHost, () => {
                // Create terminator only after Express is listening for connections
                this._httpTerminator = httpTerminator.createHttpTerminator({
                    server: this._serverInsecure,
                    gracefulTerminationTimeout: 5000
                })
                logger.log('debug', chalk.bgBlue(`[Express] Server listening on ${listenHost}:${portInsecure} (HTTP)`))
                resolve(true)
            })
        })
    }

    async _startHttpSecureServer(listenHost, portSecure) {
        const tlsDefaultKeyData     = utils.readFileSync(process.env.UNNODE_SERVER_SECURE_DEFAULT_KEY)
        const tlsDefaultCertData    = utils.readFileSync(process.env.UNNODE_SERVER_SECURE_DEFAULT_CERT)
        const tlsDefaultCAdata      = utils.readFileSync(process.env.UNNODE_SERVER_SECURE_DEFAULT_CA)

        return new Promise((resolve, reject) => {
            let error = false

            if(tlsDefaultKeyData === null) {
                logger.log('alert', `Unable to read TLS key from UNNODE_SERVER_SECURE_DEFAULT_KEY; cannot start HTTPS server.`)
                error = true
            }
            if(tlsDefaultCertData === null) {
                logger.log('alert', `Unable to read TLS cert from UNNODE_SERVER_SECURE_DEFAULT_CERT; cannot start HTTPS server.`)
                error = true
            }
            if(process.env.UNNODE_SERVER_SECURE_DEFAULT_CA && tlsDefaultCertData === null) {
                logger.log('alert', `Unable to read trusted CA certs from UNNODE_SERVER_SECURE_DEFAULT_CA; cannot start HTTPS server.`)
                error = true
            }

            if(error) {
                return reject()
            }
    
            let options = {
                key: tlsDefaultKeyData,
                cert: tlsDefaultCertData,
            }

            if (tlsDefaultCAdata !== null) {
                options['ca'] = tlsDefaultCAdata
            }

            if (process.env.UNNODE_SERVER_SECURE_MINVERSION) {
                options['minVersion'] = process.env.UNNODE_SERVER_SECURE_MINVERSION
            }


            //
            // Setup SNI callback for vhost specific certificates
            //
            options['SNICallback'] = (domain, cb) => {
                const vhostConfig = this._serverConfig.filter((config) => {
                    const wildcardDomain = '*' + domain.substr(domain.indexOf('.'))

                    if(config.vhost.includes(domain) || config.vhost.includes(wildcardDomain)) {
                        return true
                    }

                    return false
                })

                if(vhostConfig.length === 1) {
                    cb(null, vhostConfig[0].secureContext)
                } else {
                    cb()
                }
            }


            this._serverSecure = https.createServer(options, this._serverApp)

            this._serverSecure.on('error', this._handleHttpServerError.bind(this))
            this._serverSecure.on('clientError', this._handleHttpClientError.bind(this))

            this._serverSecure.on('close', () => {
                logger.log('debug', chalk.bgBlue('[Express] HTTPS Server closed'))
            })

            this._serverSecure.listen(portSecure, listenHost, () => {
                // Create terminator only after Express is listening for connections
                this._httpsTerminator = httpTerminator.createHttpTerminator({
                    server: this._serverSecure,

                    // This should be lower than the force-KILL timeout in master.js
                    gracefulTerminationTimeout: 5000
                })

                logger.log('debug', chalk.bgBlue(`[Express] Server listening on ${listenHost}:${portSecure} (HTTPS)`))

                resolve()
            })
        })
    }


    _parseServerConfig(configFilePath) {
        try {
            const serverConfig = require(configFilePath)

            if(!Array.isArray(serverConfig)) {
                throw new Error(`Unnode.js server config file did not export an array`)
            }

            serverConfig.map((config, idx) => {
                return this._parseConfigEntry(config, idx)
            })

            return serverConfig
        } catch (error) {
            throw error
        }
    }


    _parseConfigEntry(config, idx) {
        let configErrors = false

        if(!utils.isObject(config)) {
            throw new Error(`Unnode.js server config entry at index ${idx} is not an object`)
        }

        if(!Object.keys(config).includes('vhost')) {
            throw new Error(`Unnode.js server config entry at index ${idx}: missing "vhost" property`)
        }

        if(!Array.isArray(config.vhost)) {
            throw new Error(`Unnode.js server config entry at index ${idx}: "vhost" must be an array`)
        }

        config.vhost.map((vhost, idx2) => {
            if(typeof vhost !== 'string') {
                throw new Error(`Unnode.js server config entry at index ${idx}: vhost at idx ${idx2} is not a string`)
            }

            if(vhost.length === 0) {
                throw new Error(`Unnode.js server config entry at index ${idx}: vhost at idx ${idx2} is empty`)
            }
        })

        let secureServer = false
        const portSecure = process.env.UNNODE_SERVER_SECURE_PORT

        if(portSecure && !isNaN(portSecure)) {
            secureServer = true
        }

        if(secureServer) {
            if(config.secureContext && utils.isObject(config.secureContext)) {
                const contextKey  = utils.readFileSync(config.secureContext.key)
                const contextCert = utils.readFileSync(config.secureContext.cert)
                const contextCA   = utils.readFileSync(config.secureContext.ca)

                if(contextKey === null) {
                    throw new Error(`Unable to read secure context keyfile at index ${idx} (${config.vhost.join(', ')})`)
                }

                if(contextCert === null) {
                    throw new Error(`Unable to read secure context certfile at index ${idx} (${config.vhost.join(', ')})`)
                }

                let secureContext = {
                    key: contextKey,
                    cert: contextCert
                }

                if(config.secureContext.ca && contextCA === null) {
                    throw new Error(`Unable to read secure context CA file at index ${idx} (${config.vhost.join(', ')})`)
                } else if(config.secureContext.ca && contextCA !== null) {
                    secureContext['ca'] = contextCA
                }

                config.secureContext = tls.createSecureContext(secureContext)
            } else {
                logger.log('debug', `Secure server requested but vhost "${config.vhost.join(', ')}" has no secureContext entry, using default credentials.`)
            }
        }

        if(configErrors === true) {
            throw new Error(`Errors while parsing Unnode.js server config file, exiting.`)
        }

        return config
    }


    async shutdownServer() {
        if(this._serverQuitting === false) {
            this._serverQuitting = true

            clearInterval(this._pingInterval)

            if(this._shutdownCallback && typeof this._shutdownCallback === 'function') {
                await this._shutdownCallback()
            }
    
            // Gracefully exit HTTP(S) connections
            if (this._httpTerminator !== null) {
                logger.log('debug', 'Gracefully closing HTTP connections...')
                await this._httpTerminator.terminate()
            }

            if (this._httpsTerminator !== null) {
                logger.log('debug', 'Gracefully closing HTTPS connections...')
                await this._httpsTerminator.terminate()
            }

            // Send process shutdown request to master process
            process.send({ 'type': 'shutdown' })
        }

        return true
    }


    _handleHttpServerError(error) {
        if(error.code === 'EACCES') {
            logger.log('emerg', `Failed to start HTTP server: Access denied when binding to ${error.address} port ${error.port}`)
        } else if(error.code === 'EADDRINUSE') {
            logger.log('emerg', `Failed to start HTTP server: Address already in use: ${error.address}:${error.port}`)
        } else {
            logger.log('emerg', `Failed to start HTTP server: ${error.code} (${error.errno}), syscall: ${error.syscall}, stack trace:\n${error.stack}`)
        }

        this.shutdownServer()
    }


    _handleHttpClientError(err, socket) {
        try {
            /* In some cases, the client has already received the response and/or the socket has already
               been destroyed, like in case of ECONNRESET errors. Before trying to send data to the socket,
               it is better to check that it is still writable.
               https://nodejs.org/api/http.html#http_event_clienterror
            */
            if (err.code === 'ECONNRESET' || !socket.writable) {
                logger.log('warning', `HTTP clientError: ${err.code} (socket already destroyed)`, 'no-rollbar')
                return
            }

            const ip = socket.remoteAddress

            const errorBody = err.code
            const contentLength = errorBody.length

            let response = 'HTTP/1.1 400 Bad Request\r\n'
            response += 'Content-Type: text/plain\r\n'
            response += 'Content-Length: ' + contentLength + '\r\n'
            response += 'Connection: close\r\n'
            response += 'Date: ' + (new Date()).toUTCString() + '\r\n'
            response += '\r\n'
            response += errorBody

            logger.log('warning', `HTTP clientError: ${err.code}, remoteAddress: ${ip}`, 'no-rollbar')

            socket.write(
                response,
                'UTF-8',
                () => socket.end()
            )
        }
    
        catch(fatalErr) {
            logger.safeError('error', '_handleHttpClientError()', fatalErr)
            if(socket.writable) {
                socket.end()
            }
        }
    }

}


module.exports = new UnnodeWorker()
