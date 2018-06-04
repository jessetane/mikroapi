var net = require('net')
var tls = require('tls')
var crypto = require('crypto')

module.exports = class MikroApi {
  constructor (opts = {}) {
    opts.timeout = opts.timeout || 5000
    this.opts = opts
  }

  connect (cb) {
    if (this.connection) {
      return cb()
    } else {
      delete this.closed
    }
    this.queue = [cb]
    this.connection = this.opts.tls
      ? tls.connect(this.opts.port, this.opts.host, this.opts.tls)
      : net.connect(this.opts.port, this.opts.host)
    this.connection.on('error', err => this.onclose(err))
    this.connection.on('close', () => this.onclose())
    this.connection.on('connect', () => this.login())
    var buffer = ''
    var state = null
    var response = null
    var attributes = null
    this.connection.on('data', data => {
      clearTimeout(this.timer)
      buffer += data
      while (buffer.length) {
        var length = this.decodeLength(buffer)
        if (length < 0) return
        var offset = length[0]
        buffer = buffer.slice(offset)
        length = length[1]
        if (length === 0) {
          if (state === '!re') {
            response.push(attributes)
            attributes = null
          } else {
            var res = Array.isArray(response) ? response : attributes
            response = attributes = null
            var cb = this.queue.shift()
            cb(null, res)
          }
        }
        if (buffer.length === 0) return
        var word = buffer.slice(0, length)
        buffer = buffer.slice(length)
        if (word.indexOf('!') === 0) {
          if (word === '!fatal') {
            this.close()
            length = this.decodeLength(buffer)
            offset = length[0]
            length = length[1]
            var message = buffer.slice(offset, offset + length)
            var cb = this.queue.shift()
            cb(new Error(word + ' ' + message))
            return  
          } else {
            state = word
          }
        } else {
          if (!response) {
            if (state === '!re') {
              response = []
            }
          }
          if (!attributes) {
            attributes = {}
          }
          if (word) {
            var parts = word.split('=')
            attributes[parts[1]] = parts[2]
          }
        }
      }
    })
  }

  exec (command, params, cb) {
    if (typeof params === 'function') {
      cb = params
      params = {}
    }
    this.queue.push(cb)
    var sentence = ''
    sentence += this.encodeLength(command) + command
    for (var key in params) {
      var word = '=' + key + '=' + params[key]
      sentence += this.encodeLength(word) + word
    }
    sentence += '\x00'
    this.connection.write(sentence)
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.connection.destroy()
    }, this.opts.timeout)
  }

  login () {
    var cb = this.queue.shift()
    this.exec('/login', (err, res) => {
      if (err) return cb(err)
      var hash = crypto.createHash('MD5')
      hash.update('\x00')
      hash.update(this.opts.password)
      hash.update(new Buffer(res.ret, 'hex'))
      this.exec('/login', {
        name: this.opts.username,
        response: '00' + hash.digest('hex')
      }, cb)
    })
  }

  onclose (err) {
    if (this.closed || !this.connection) return
    if (!err) err = new Error('connection timeout')
    this.teardown(err)
  }

  close () {
    this.closed = true
    this.teardown(new Error('connection closed'))
  }

  teardown (err) {
    clearTimeout(this.timer)
    this.connection.destroy()
    delete this.connection
    while (this.queue.length) this.queue.shift()(err)
  }

  encodeLength (word) {
    var length = word.length
    var buf = []
    if (length < 0x80) {
      buf.push(length)
    } else if (length < 0x4000) {
      length |= 0x8000
      buf.push(
        (length >> 8) & 0xFF,
        length & 0xFF
      )
    } else if (length < 0x200000) {
      length |= 0xC00000
      buf.push(
        (length >> 16) & 0xFF,
        (length >> 8) & 0xFF,
        length & 0xFF
      )
    } else if (length < 0x10000000) {
      length |= 0xE0000000
      buf.push(
        (length >> 24) & 0xFF,
        (length >> 16) & 0xFF,
        (length >> 8) & 0xFF,
        length & 0xFF
      )
    } else {
      buf.push(
        0xF0,
        (length >> 24) & 0xFF,
        (length >> 16) & 0xFF,
        (length >> 8) & 0xFF,
        length & 0xFF
      )
    }
    return buf.map(b => String.fromCodePoint(b)).join('')
  }

  decodeLength (word) {
    word = new Buffer(word)
    var length = word[0]
    if ((length & 0x80) == 0x00) {
      length = word[0]
      return [1,length]
    } else if ((length & 0xC0) == 0x80) {
      if (word.length < 2) return -1
      length &= ~0xC0
      length <<= 8
      length += word[1]
      return [2,length]
    } else if ((length & 0xE0) == 0xC0) {
      if (word.length < 3) return -1
      length &= ~0xE0
      length <<= 8
      length += word[1]
      length <<= 8
      length += word[2]
      return [3,length]
    } else if ((length & 0xF0) == 0xE0) {
      if (word.length < 4) return -1
      length &= ~0xF0
      length <<= 8
      length += word[1]
      length <<= 8
      length += word[2]
      length <<= 8
      length += word[3]
      return [4,length]
    } else if ((length & 0xF8) == 0xF0) {
      if (word.length < 5) return -1
      length = word[1]
      length <<= 8
      length += word[2]
      length <<= 8
      length += word[3]
      length <<= 8
      length += word[4]
      return [5,length]
    }
  }
}
