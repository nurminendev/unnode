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


/*
 * Express vhost router middleware
 *
 * Taken from https://github.com/panthershark/express-vhost
 * 
 * (c) Tommy Messbauer 
 *
 */
class ExpressVhostRouter {
    _hostDictionary = {}

    constructor() {

    }

    middleware(trustProxy = false) {
        return (req, res, next) => {
            if(!req.headers.host) {
                return next()
            }

            let host = req.headers.host.split(':')[0]

            if(trustProxy && req.headers["x-forwarded-host"]) {
                host = req.headers["x-forwarded-host"].split(':')[0]
            }

            let app = this._hostDictionary[host]

            if(!app) {
                app = this._hostDictionary['*' + host.substr(host.indexOf('.'))]
            }

            if(!app) {
                return next()
            }

            if(typeof app === 'function') {
                return app(req, res, next)
            }

            app.emit('request', req, res)
        }
    }


    register(host, app) {
        this._hostDictionary[host] = app
    }


    getApp(host) {
        return this._hostDictionary[host]
    }

}


module.exports = new ExpressVhostRouter
