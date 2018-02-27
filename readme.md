# mikroapi
Minimalist [Mikrotik API](https://wiki.mikrotik.com/wiki/Manual:API) client

## Why
The JavaScript client recommended on the wiki doesn't properly specify its dependencies.

## How
Just a very basic port of the python implementation shown on the wiki.

## Example
``` javascript
var api = new MikroApi({
  host: '1.1.1.1',
  port: 8729,
  username: 'admin',
  password: 'xxx',
  tls: {
    rejectUnauthorized: false // maybe don't do this
  }
})

api.connect(err => {
  if (err) throw err
  api.exec('/routing/bgp/peer/print', {
    '.proplist': 'prefix-count,disabled,state,uptime,remote-as,remote-address'
  }, (err, res) => {
    if (err) throw err
    console.log(res)
  })
})
```

## License
MIT
