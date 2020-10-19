//
//
// Unnode.js - A Node.js backend framework
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
const http              = require('http')
const https             = require('https')
const httpTerminator    = require('http-terminator')
const express           = require('express')
const helmet            = require('helmet')
const chalk             = require('chalk')

const logger            = require('./logger.js').workerLogger
const utils             = require('./utils.js')


class UnnodeWorker {
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
        process.title = 'unnode-worker'

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

        // Helmet on, for safety.
        this._serverApp.use(helmet())

        // Routes from config/routes.js
        const routes = require(path.join(serverDir, 'config', 'routes.js'))

        routes.forEach((route) => {
            const routeMethod   = route.method
            const routePath     = route.path
            const routeModule   = route.controller.substr(0, route.controller.indexOf('#'))
            const routeHandler  = route.controller.substring(route.controller.lastIndexOf('#') + 1)

            const routeCustomParameter = route.customParameter || null

            const routeHandlerObject = require(path.join(serverDir, 'controllers', `${routeModule}.js`))

            this._serverApp[routeMethod.toLowerCase()](routePath, routeHandlerObject[routeHandler].bind(routeHandlerObject, routeCustomParameter))

            logger.log('debug', `UnnodeWorker#setupServer: Added ${routeMethod} ${routePath}, controller: ${route.controller}`)
        })

        this._pingInterval = setInterval(() => {
            process.send({ 'type': 'pingConsole' })
        }, 60000)

        return true
    }


    addWildcardRoute() {
        // Default endpoint for everything else
        this._serverApp.use((req, res) => {
            const ip     = utils.getClientIp(req)
            const method = req.method
            const url    = req.originalUrl
            const agent  = req.get('user-agent')
            logger.log('notice', `Wildcard request ${method} ${url} (from: ${ip}, User-Agent: ${agent})`, 'no-rollbar')
            res.status(404).send('404 Not Found')
        })

        logger.log('debug', `UnnodeWorker#addWildCardRoute: Added wildcard route handler (404 reply + request logging)`)
    }


    async runServer() {
        // Default to listening on all interfaces if not set in ENV
        const listenHost = process.env.SERVER_LISTEN_HOST || '0.0.0.0'

        const portInsecure = process.env.SERVER_LISTEN_PORT_INSECURE

        if(portInsecure && !isNaN(portInsecure)) {
            await this._startHttpServer(listenHost, portInsecure)
        }

        const portSSL    = process.env.SERVER_LISTEN_PORT_SSL
        const sslPrivKey = process.env.SERVER_SSL_PRIVKEY
        const sslCert    = process.env.SERVER_SSL_CERT
        const sslCA      = process.env.SERVER_SSL_CA

        if(portSSL && !isNaN(portSSL) && sslPrivKey && sslCert && sslCA) {
            await this._startHttpSecureServer(listenHost, portSSL, sslPrivKey, sslCert, sslCA)
        }

        if(this._serverInsecure === null && this._serverSecure === null) {
            logger.log('emerg', 'Neither HTTP nor HTTPS server was able to start, exiting...')
            return await this.shutdownServer()
        }

        process.send({
            'type': 'serverRunning',
            'listen_host': listenHost,
            'listen_port_insecure': (this._serverInsecure !== null) ? portInsecure : null,
            'listen_port_secure': (this._serverSecure !== null) ? portSSL : null
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

    async _startHttpSecureServer(listenHost, portSSL, sslPrivKey, sslCert, sslCA) {
        const sslPrivKeyData = await utils.readFile(sslPrivKey)
        const sslCertData = await utils.readFile(sslCert)
        const sslCAdata = await utils.readFile(sslCA)

        return new Promise((resolve, reject) => {
            if(sslPrivKeyData === false) {
                logger.log('alert', `Unable to read SSL cert from SERVER_SSL_PRIVKEY; cannot start HTTPS server.`)
            }
            if(sslCertData === false) {
                logger.log('alert', `Unable to read SSL cert from SERVER_SSL_CERT; cannot start HTTPS server.`)
            }
            if(sslCAdata === false) {
                logger.log('alert', `Unable to read SSL cert from SERVER_SSL_CA; cannot start HTTPS server.`)
            }
    
            if(sslPrivKeyData !== false && sslCertData !== false && sslCAdata !== false) {
                let credentials = {
                    key: sslPrivKeyData,
                    cert: sslCertData,
                    ca: sslCAdata
                }
    
                if(process.env.SERVER_SSL_MINVERSION) {
                    credentials['minVersion'] = process.env.SERVER_SSL_MINVERSION
                }
    
                this._serverSecure = https.createServer(credentials, this._serverApp)
    
                this._serverSecure.on('error', this._handleHttpServerError.bind(this))
                this._serverSecure.on('clientError', this._handleHttpClientError.bind(this))
    
                this._serverSecure.on('close', () => {
                    logger.log('debug', chalk.bgBlue('[Express] HTTPS Server closed'))
                })
    
                this._serverSecure.listen(portSSL, listenHost, () => {
                    // Create terminator only after Express is listening for connections
                    this._httpsTerminator = httpTerminator.createHttpTerminator({
                        server: this._serverSecure,
                        gracefulTerminationTimeout: 5000
                    })
                    logger.log('debug', chalk.bgBlue(`[Express] Server listening on ${listenHost}:${portSSL} (HTTPS)`))
                    resolve()
                })
            }
        })
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
