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


import fs                from 'fs'
import R                 from 'ramda'
import iso               from 'iso-3166-1'
import node_fetch        from 'node-fetch'
import AbortController   from 'abort-controller'
import requestIp         from 'request-ip'
import moment            from 'moment-timezone'


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
                resolve(null)
            } else {
                resolve(data)
            }
        })
    })
}


function readFileSync(file, encoding = 'utf8') {
    try {
        return fs.readFileSync(file, encoding)
    } catch(_) {
        return null
    }
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


function getRequestFullUrl(req, removeQuery = false) {
    const protocol = req.headers["x-forwarded-proto"] || req.protocol
    const url = removeQuery ? req.originalUrl.split("?").shift() : req.originalUrl
    return protocol + '://' + req.get('host') + url
}


function getCopyrightYears(startYearStr) {
    const startYear = moment().year(startYearStr)
    const timeNow   = moment()

    let copyrightYearsStr = startYear.format('YYYY')

    if(!startYear.isSame(timeNow, 'year')) {
        copyrightYearsStr = startYear.format('YYYY') + '-' + timeNow.format('YYYY')
    }

    return copyrightYearsStr
}


export {
    handle,
    isObject,
    isFileReadable,
    isFileReadableSync,
    readFile,
    readFileSync,
    getDirectories,
    _v,
    parseJson,
    convertCountryCodeAlpha2toAlpha3,
    convertCountryCodeAlpha3toAlpha2,
    fetch,
    safeError,
    getClientIp,
    getRequestFullUrl,
    getCopyrightYears
}
