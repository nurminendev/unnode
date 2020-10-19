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


const fs                = require('fs')
const R                 = require('ramda')
const iso               = require('iso-3166-1')
const date              = require('date-and-time')
const node_fetch        = require('node-fetch')
const AbortController   = require('abort-controller')
const requestIp         = require('request-ip')


// The Workhorse - Better async error handling
// https://dev.to/sobiodarlington/better-error-handling-with-async-await-2e5m
const handle = (promise) => {
    return Promise.resolve(promise)
        .then(data => ([data, undefined]))
        .catch(error => Promise.resolve([undefined, error]))
}


function isObject(a) {
    return (!!a) && (a.constructor === Object)
}


function isFileReadable(file) {
    return new Promise((resolve, reject) => {
        if(typeof file !== 'string') {
            resolve(false)
        }
        fs.access(file, fs.constants.R_OK, (err) => {
            if(err) {
                resolve(false)
            } else {
                resolve(true)
            }
        })
    })
}


function isFileReadableSync(file) {
    if(typeof file !== 'string') {
        return false
    }

    try {
        fs.accessSync(file, fs.constants.R_OK)
        return true
    } catch(error) {
        return false
    }
}


function readFile(file, encoding = 'utf8') {
    return new Promise((resolve, reject) => {
        fs.readFile(file, encoding, (err, data) => {
            if(err) {
                resolve(false)
            } else {
                resolve(data)
            }
        })
    })
}


// Get a list of directories inside a directory
// https://stackoverflow.com/questions/18112204/get-all-directories-within-directory-nodejs
const getDirectories = source =>
  fs.readdirSync(source, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)


function _v(list, obj, defaultValue = '') {
    return R.pathOr(defaultValue, list, obj)
}


function parseJson(jsonStr) {
    try {
        let jsonObj = JSON.parse(jsonStr)
        return [jsonObj, null]
    } catch (e) {
        return [null, Error('Invalid input data (could not JSON.parse)')]
    }
}


function convertCountryCodeAlpha3toAlpha2(countryCodeAlpha3) {
    if(countryCodeAlpha3) {
        let countryCodeConv = iso.whereAlpha3(countryCodeAlpha3)
        if (countryCodeConv) {
            return countryCodeConv.alpha2
        }
    }

    return null
}


function convertCountryCodeAlpha2toAlpha3(countryCodeAlpha2) {
    if(countryCodeAlpha2) {
        let countryCodeConv = iso.whereAlpha2(countryCodeAlpha2)
        if (countryCodeConv) {
            return countryCodeConv.alpha3
        }
    }

    return null
}


/*
 * Get a timestamp in ISO 8601 format.
 *
 * 'time' can be a string accepted by javascript Date() object constructor.
 * 
 * If 'time' is null, will return current time in ISO 8601 format.
 * 
 * excludeMS: Either include or exclude milliseconds in the returned timestamp.
 * 
 * Example return values:
 * 
 * With milliseconds: 2020-07-15T15:14:36.579+03:00
 * Without milliseconds: 2020-07-15T15:14:36+03:00
 *
 */
function getTimestamp(time, excludeMS) {
    let now = new Date()
    if(time) {
        now = new Date(time)
    }
    let zone = date.format(now, 'Z')
    zone = zone.slice(0, 3) + ':' + zone.slice(3)
    if(excludeMS) {
        return date.format(now, 'YYYY-MM-DD[T]HH:mm:ss') + zone
    } else {
        return date.format(now, 'YYYY-MM-DD[T]HH:mm:ss.SSS') + zone
    }
}


/*
 * Simple node-fetch wrapper, implements request timeout properly
 * with 'abort-controller'.
 * 
 * Use with handle() async error handler above:
 * 
 * let [res, error] = await handle(fetch('http://test.com'))
 */
function fetch(url, options = {}, timeout = 15000) {
    const requestController = new AbortController()

    const requestTimeout = setTimeout(() => {
        requestController.abort()
    }, timeout)

    options['signal'] = requestController.signal

    return node_fetch(url, options)
        .then((res) => {
            if (res.ok) {
                return res
            } else {
                let error = new Error('Non-OK HTTP response')
                error.httpResponse = res
                throw error
            }
        })
        .catch((error) => {
            if(error.type === 'aborted') {
                error = new Error(`Request timed out at ${url}`)
                error.type = 'aborted'
            }

            // Re-throw, to be catched in caller
            throw error
        })
        .finally(() => {
            clearTimeout(requestTimeout)
        })
}


function safeError(error) {
    if(error instanceof Error) {
        return error.message
    } else {
        return error
    }
}


function getClientIp(req) {
    let ip = '<unknown>'

    try {
        ip = requestIp.getClientIp(req)
    } catch(e) { }

    return ip
}


module.exports = {
    handle: handle,
    isObject: isObject,
    isFileReadable: isFileReadable,
    isFileReadableSync: isFileReadableSync,
    readFile: readFile,
    getDirectories: getDirectories,
    _v: _v,
    parseJson: parseJson,
    convertCountryCodeAlpha2toAlpha3: convertCountryCodeAlpha2toAlpha3,
    convertCountryCodeAlpha3toAlpha2: convertCountryCodeAlpha3toAlpha2,
    getTimestamp: getTimestamp,
    fetch: fetch,
    safeError: safeError,
    getClientIp: getClientIp
}
