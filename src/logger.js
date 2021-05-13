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


import fs            from 'fs'
import path          from 'path'
import winston       from 'winston'
import winstonRotate from 'winston-daily-rotate-file'
import chalk         from 'chalk'
import stripAnsi     from 'strip-ansi'
import Rollbar       from 'rollbar'
import moment        from 'moment-timezone'


/*

Master process logger class

Forked child worker processes (Node Cluster API) will send log messages
to this centralized logger

syslog levels:

  emerg:    0
  alert:    1
  crit:     2
  error:    3
  warning:  4
  notice:   5
  info:     6
  debug:    7

*/
class MasterLogger {
    _initialized        = false
    _fileLogger         = null
    _consoleLogger      = null
    _rollbar            = null
    _timestampFunc      = null
    _lastLogTimestamp   = 0


    constructor() {
        // Timestamper with timezones
        this._timestampFunc = winston.format((info) => {
            const appTimezone = process.env.UNNODE_TIMEZONE
            const supportedTimezones = moment.tz.names()

            if(appTimezone && supportedTimezones.includes(appTimezone)) {
                info.timestamp = moment().tz(appTimezone).toISOString(true)
            } else {
                info.timestamp = moment().toISOString(true)
            }
            return info
        })
    }


    init(serverDir) {
        // Only init once
        if(this._initialized === true) {
            return true
        }

        // File logging with logrotate
        if(process.env.UNNODE_LOGFILE) {
            this._setupFileLogging(serverDir, process.env.UNNODE_LOGFILE)
        }

        // Console logging
        this._setupConsoleLogging()

        // Rollbar
        this._initRollbar()

        this._initialized = true

        return true
    }


    async log(level, message, overrideRollbar = null) {
        if(this._initialized === false) {
            console.log('LOGGER NOT INITIALIZED - Did you forget to call init() ?')
            return
        }

        if(overrideRollbar !== 'only-rollbar') {
            if(this._fileLogger !== null) {
                // Log to file
                this._fileLogger.log({
                    level: level,
                    message: message
                })
            }
    
            // Log to console
            this._consoleLogger.log({
                level: level,
                message: message
            })
        }

        if(overrideRollbar !== 'no-rollbar') {
            if(overrideRollbar === 'force-rollbar' ||
                overrideRollbar === 'only-rollbar' ||
                level === 'warning' ||
                level === 'error' ||
                level === 'crit' ||
                level === 'alert' ||
                level === 'emerg') {

                // Log to Rollbar
                this._rollbarLog(level, message)
            }
        }

        if(process.env.NODE_ENV !== 'production') {
            // development: set timestamp always
            this._lastLogTimestamp = Math.round((new Date()).getTime() / 1000)
        } else if(level !== 'debug') {
            // production: only set timestamp for info and higher
            this._lastLogTimestamp = Math.round((new Date()).getTime() / 1000)
        }
    }


    _rollbarLog(level, message) {
        if(this._rollbar !== null) {
            let rollbarLevel = level
            if(level === 'notice') {
                rollbarLevel = 'info'
            } else if(level === 'crit' || level === 'alert' || level === 'emerg') {
                rollbarLevel = 'critical'
            }

            this._rollbar.configure({ logLevel: rollbarLevel })
            this._rollbar.log(stripAnsi(message))
        }
    }


    /*
     * Utility function for Morgan to write to our logfile
     * (but not to console)
     */
    _morganWrite(message) {
        // Only log morgan messages to file, not to console
        this.winstonFile.info(message.substring(0, message.lastIndexOf('\n')))
    }


    _setupFileLogging(serverDir, logFile) {
        // Logfiles go to project-dir/log
        const logDir = path.join(serverDir, 'log')

        const stripAnsiFormat = winston.format((info, opts) => {
            info.message = stripAnsi(info.message)
            return info
        })

        const logFileRotate = `${logFile}-%DATE%`
        const symlinkFile   = logFile

        const fileRotateTransport = new winston.transports.DailyRotateFile({
            level: 'debug',
            filename: logFileRotate,
            dirname: logDir,
            datePattern: 'YYYY-MM-DD',
            maxSize: '20m',
            maxFiles: '30',
            createSymlink: true,
            symlinkName: symlinkFile,
            handleExceptions: true,
            handleRejections: true
        })

        fileRotateTransport.on('rotate', (oldFilename, newFilename) => {
            this._consoleLogger.log({
                level: 'debug',
                message: `Log rotate: ${chalk.whiteBright.bold(path.basename(oldFilename))} -> ${chalk.whiteBright.bold(path.basename(newFilename))}`
            })
        })

        fileRotateTransport.on('logRemoved', (removedFilename) => {
            this._consoleLogger.log({
                level: 'debug',
                message: `Log removed: ${chalk.whiteBright.bold(path.basename(removedFilename))}`
            })
        })

        winston.loggers.add('fileLogger', {
            levels: winston.config.syslog.levels,
            format: winston.format.combine(
                this._timestampFunc(),
                stripAnsiFormat(),
                winston.format.json()
            ),
            transports: [ fileRotateTransport ],
            exitOnError: false
        })

        this._fileLogger = winston.loggers.get('fileLogger')

    }


    _setupConsoleLogging() {
        // Console logging
        const consoleFormat = winston.format.printf(({ level, message, label, timestamp }) => {
            switch(level) {
                case 'emerg':
                    level = chalk.bold.underline.bgRedBright('! EMERGENCY !')
                    break
                case 'alert':
                    level = chalk.bgRed(level)
                    break
                case 'crit':
                    level = chalk.underline.redBright('critical!')
                    break
                case 'error':
                    level = chalk.redBright(level)
                    break
                case 'warning':
                    level = chalk.yellowBright(level)
                    break
                case 'notice':
                    level = chalk.cyanBright(level)
                    break
                case 'info':
                    level = chalk.greenBright(level)
                    break
                case 'debug':
                    level = chalk.magenta(level)
                    break
                default:
                    break
            }

            if(process.env.UNNODE_DISABLE_TIMESTAMP_CONSOLE) {
                return `${level}: ${message}`
            } else {
                return `${timestamp} ${level}: ${message}`
            }
        })

        winston.loggers.add('consoleLogger', {
            levels: winston.config.syslog.levels,
            format: winston.format.combine(
                this._timestampFunc(),
                consoleFormat
              ),
            transports: [
                new winston.transports.Console({
                    level: process.env.NODE_ENV !== 'production' ? 'debug' : 'info',
                    handleExceptions: true,
                    handleRejections: true
                })
            ],
            exitOnError: false
        })

        this._consoleLogger = winston.loggers.get('consoleLogger')
    }


    pingConsole(pingIfNoActivityInSeconds) {
        const now = Math.round((new Date()).getTime() / 1000)

        if(now - this._lastLogTimestamp >= pingIfNoActivityInSeconds) {
            this._consoleLogger.log({
                level: 'info',
                message: `ping! (no activity in 2 hours)`
            })
            this._lastLogTimestamp = now
        }
    }


    _initRollbar() {
        const rollbarToken = process.env.ROLLBAR_ACCESS_TOKEN
        const rollbarEnv = process.env.ROLLBAR_ENVIRONMENT

        if(rollbarToken && rollbarEnv) {
            this._rollbar = new Rollbar({
                accessToken: rollbarToken,
                environment: rollbarEnv,
                captureUncaught: false,
                captureUnhandledRejections: false
            })
        }
    }


    // Safely log an error, hiding stack trace on production
    async safeError(level, message, error, overrideRollbar = null) {
        if (error instanceof Error) {
            if (process.env.NODE_ENV !== 'production') {
                this.log(level, `${message}: ${error.stack}`, overrideRollbar)
            } else {
                this.log(level, `${message}: ${error.name}: ${error.message}`, overrideRollbar)
            }
        } else {
            this.log(level, `${message}: ${error}`)
        }
    }

}


/*

Worker process logging class

Just sends log messages to the master process logger via IPC

*/
class WorkerLogger {
    async log(level, message, overrideRollbar = null) {
        // Prefix with [pid]
        const prefix = chalk.bgRed(`[${process.pid}]`)
        if(process.connected !== false) {
            process.send({
                'type': 'log',
                'level': level,
                'message': `${prefix} ${message}`,
                'overrideRollbar': overrideRollbar
            })
        }
    }


    // Safely log an error, hiding stack trace on production
    async safeError(level, message, error, overrideRollbar = null) {
        if (error instanceof Error) {
            if (process.env.NODE_ENV !== 'production') {
                this.log(level, `${message}: ${error.stack}`, overrideRollbar)
            } else {
                this.log(level, `${message}: ${error.name}: ${error.message}`, overrideRollbar)
            }
        } else {
            this.log(level, `${message}: ${error}`)
        }
    }
}


export const masterLogger = new MasterLogger()
export const workerLogger = new WorkerLogger()
