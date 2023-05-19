import net from 'net'
import tls from 'tls'
import crypto from 'crypto'

function Deferred () {
	let s, f, p = new Promise((_s, _f) => { s = _s; f = _f })
	p.resolve = s
	p.reject = f
	return p
}

class MikroApi {
	constructor (opts = {}) {
		opts.timeout = opts.timeout || 5000
		this.opts = opts
		this.buffer = ''
		this.state = null
		this.response = null
		this.attributes = null
		this.onclose = this.onclose.bind(this)
		this.ondata = this.ondata.bind(this)
	}

	connect () {
		if (this.connection) return
		delete this.closed
		const p = new Deferred()
		this.queue = [p]
		this.connection = this.opts.tls
			? tls.connect(this.opts.port, this.opts.host, this.opts.tls)
			: net.connect(this.opts.port, this.opts.host)
		this.connection.on('error', this.onclose)
		this.connection.on('close', this.onclose)
		this.connection.on('data', this.ondata)
		this.connection.on('connect', async () => {
			this.queue.shift()
			try {
				const res = await this.login()
				p.resolve()
			} catch (err) {
				p.reject(err)
			}
		})
		this.timer = setTimeout(() => {
			this.connection.destroy()
		}, this.opts.timeout)
		return p
	}

	ondata (data) {
		clearTimeout(this.timer)
		this.buffer += data
		while (this.buffer.length) {
			let length = this.decodeLength(this.buffer)
			if (length < 0) return
			let offset = length[0]
			this.buffer = this.buffer.slice(offset)
			length = length[1]
			if (length === 0) {
				if (this.state === '!re') {
					this.response.push(this.attributes)
					this.attributes = null
				} else {
					const res = Array.isArray(this.response) ? this.response : this.attributes
					this.response = this.attributes = null
					const p = this.queue.shift()
					if (p) {
						if (res?.message) {
							p.reject(new Error(res.message))
						} else {
							p.resolve(res)
						}
					}
				}
			}
			if (this.buffer.length === 0) return
			const word = this.buffer.slice(0, length)
			this.buffer = this.buffer.slice(length)
			if (word.indexOf('!') === 0) {
				if (word === '!fatal') {
					length = this.decodeLength(buffer)
					offset = length[0]
					length = length[1]
					var message = this.buffer.slice(offset, offset + length)
					const p = this.queue.shift()
					if (p) p.reject(new Error(word + ' ' + message))
					this.close()
					return
				} else {
					this.state = word
				}
			} else {
				if (!this.response) {
					if (this.state === '!re') {
						this.response = []
					}
				}
				if (!this.attributes) {
					this.attributes = {}
				}
				if (word) {
					const parts = word.split('=')
					this.attributes[parts[1]] = parts[2]
				}
			}
		}
	}

	exec (command, params) {
		const p = new Deferred()
		this.queue.push(p)
		this.connection.write(this.encodeLength(command))
		this.connection.write(command)
		for (var key in params) {
			var word = key + '=' + params[key]
			if (key[0] !== '?') word = '=' + word
			this.connection.write(this.encodeLength(word))
			this.connection.write(word)
		}
		this.connection.write('\x00')
		clearTimeout(this.timer)
		this.timer = setTimeout(() => {
			this.connection.destroy()
		}, this.opts.timeout)
		return p
	}

	async login () {
		return this.exec('/login', {
			name: this.opts.username,
			password: this.opts.password
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
		while (this.queue.length) {
			const p = this.queue.shift()
			p.reject(err)
		}
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
		return new Uint8Array(buf)
	}

	decodeLength (word) {
		word = Buffer.from(word)
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

export default MikroApi
