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


import cluster  from 'cluster'

import unnodeMaster from './src/master.js'
import unnodeWorker from './src/worker.js'

import { masterLogger as unnodeMasterLogger } from './src/logger.js'
import { workerLogger as unnodeWorkerLogger } from './src/logger.js'

import * as unnodeUtils from './src/utils.js'


export const master = cluster.isMaster ? unnodeMaster : null
export const worker = cluster.isWorker ? unnodeWorker : null

export const masterLogger = cluster.isMaster ? unnodeMasterLogger : null
export const workerLogger = cluster.isWorker ? unnodeWorkerLogger : null

export const isMaster = cluster.isMaster
export const isWorker = cluster.isWorker

export const utils = unnodeUtils
