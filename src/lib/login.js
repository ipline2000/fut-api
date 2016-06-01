'use strict'

module.exports = function (options) {
  var __ = require('underscore')
  var request = require('request')
  var hasher = require('./eaHasher')
  var urls = require('./urls')
  var CookieJar = require('tough-cookie').CookieJar
  var utils = require('./utils')

  var defaultRequest = null

  var loginDetails = {}

  var loginResponse = {
    nucleusId: null,
    shardInfos: null,
    shard: null,
    persona: null,
    sessionData: null,
    apiRequest: null
  }

  var jar = request.jar()

  var Login = function () {}

  Login.prototype.login = function (email, password, secret, platform, tfCodeCb, captchaCb, loginCb) {
    if (!email || !__.isString(email) || email.trim().length <= 0) return loginCb(new Error('Email is empty.'))

    if (!password || !__.isString(password) || password.trim().length <= 0) return loginCb(new Error('Password is empty.'))

    if (!secret || !__.isString(secret) || email.trim().length <= 0) return loginCb(new Error('Secret is empty.'))

    if (!platform || !__.isString(platform) || platform.trim().length <= 0) return loginCb(new Error('Platform is empty.'))
    if (!getPlatform(platform)) return loginCb(new Error('Platform is invalid.'))

    if (!__.isFunction(tfCodeCb)) return loginCb(new Error('tfCodeCb is not a function.'))

    if (!__.isFunction(captchaCb)) return loginCb(new Error('captchaCb is not a function.'))

    if (!__.isFunction(loginCb)) return loginCb(new Error('loginCb is not a function.'))

    loginDetails = {
      'email': email,
      'password': password,
      'secret': hasher(secret),
      'tfCodeCb': tfCodeCb,
      'loginCb': loginCb,
      'gameSku': getGameSku(platform),
      'platform': getPlatform(platform),
      captchaCb: captchaCb
    }

    defaultRequest = request.defaults({
      jar: jar,
      followAllRedirects: true,
      gzip: true,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 6.3; WOW64; Trident/7.0; rv:11.0) like Gecko',
        'Accept': 'text/html, application/xhtml+xml, */*',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'en-US,en;q=0.8',
        'Connection': 'keep-alive',
        'DNT': '1',
        'Cache-Control': 'no-cache'
      }
    })

    getMain()
  }

  Login.prototype.getCookieJarJSON = function () {
    return jar._jar.serializeSync()
  }

  Login.prototype.setCookieJarJSON = function (json) {
    jar._jar = CookieJar.deserializeSync(json)
  }

  Login.prototype.getCaptcha = function (cb) {
    const url = urls.login.getCaptcha + new Date().getTime()
    defaultRequest.get(url, function (error, response, body) {
      if (error) return cb(error)
      if (response.statusCode !== 200) return cb(new Error(`Captcha error ${response.statusCode} ${body}`))
      cb(body)
    })
  }

  function getGameSku (platform) {
    switch (platform) {
      case 'pc':
        return 'FFA16PCC'
      case 'ps3':
        return 'FFA16PS3'
      case 'ps4':
        return 'FFA16PS4'
      case 'x360':
        return 'FFA16XBX'
      case 'xone':
        return 'FFA16XBO'
    }

    return null
  }

  function getPlatform (platform) {
    switch (platform) {
      case 'pc':
        return 'pc'
      case 'ps3':
      case 'ps4':
        return 'ps3'
      case 'x360':
      case 'xone':
        return '360'
    }
    return null
  }

  function getMain () {
    defaultRequest.get(urls.login.main, function (error, response, body) {
      if (error) return loginDetails.loginCb(error)

      if (body.indexOf('<title>FIFA Football | FUT Web App | EA SPORTS</title>') > 0) return getNucleus()

      if (body.indexOf('<title>Log In</title>') > 0) return loginForm(response.request.href)

      loginDetails.loginCb(new Error('Unknown response. Unable to login.'))
    })
  }

  function loginForm (url) {
    defaultRequest.post(url, {
      form: {
        'email': loginDetails.email,
        'password': loginDetails.password,
        '_rememberMe': 'on',
        'rememberMe': 'on',
        '_eventId': 'submit',
        'facebookAuth': ''
      }
    }, function (error, response, body) {
      if (error) return loginDetails.loginCb(error)

      if (body.indexOf('<title>FIFA Football | FUT Web App | EA SPORTS</title>') > 0) return getNucleus()

      if (body.indexOf('<title>Log In</title>') > 0) return loginDetails.loginCb(new Error('Unable to log in.'))

      if (body.indexOf('<title>Set Up an App Authenticator</title>') > 0) return cancelLoginVerificationUpdate(response.request.href)

      if (body.indexOf('<title>Login Verification</title>') > 0) {
        loginDetails.tfCodeCb(function (tfCode) {
          return sendTwoFactorCode(response.request.href, tfCode)
        })
        return
      }
      loginDetails.loginCb(new Error('Unknown response. Unable to login.'))
    })
  }

  function sendTwoFactorCode (url, tfCode) {
    defaultRequest.post(url, {
      form: {
        'twofactorCode': tfCode,
        'twoFactorCode': tfCode,
        '_eventId': 'submit',
        '_trustThisDevice': 'on',
        'trustThisDevice': 'on'
      }
    }, function (error, response, body) {
      if (error) return loginDetails.loginCb(error)

      if (body.indexOf('<title>FIFA Football | FUT Web App | EA SPORTS</title>') > 0) return getNucleus()

      if (body.indexOf('<title>Set Up an App Authenticator</title>') > 0) return cancelLoginVerificationUpdate(response.request.href)

      if (body.indexOf('<title>Login Verification</title>') > 0) return loginDetails.loginCb(new Error('Wrong two factor code.'))

      loginDetails.loginCb(new Error('Unknown response. Unable to login.'))
    })
  }

  function cancelLoginVerificationUpdate (url) {
    defaultRequest.post(url, {
      form: {
        '_eventId': 'cancel',
        'appDevice': 'IPHONE'
      }
    }, function (error, response, body) {
      if (error) return loginDetails.loginCb(error)

      if (body.indexOf('<title>FIFA Football | FUT Web App | EA SPORTS</title>') > 0) return getNucleus()

      loginDetails.loginCb(new Error('Unknown response. Unable to login.'))
    })
  }

  function getNucleus () {
    defaultRequest.get(urls.login.nucleus, function (error, response, body) {
      if (error) return loginDetails.loginCb(error)

      var match = body.match(/EASW_ID\W*=\W*'(\d*)'/)
      if (match === null || match[1] === null) return loginDetails.loginCb(new Error("Unable to get the 'EASW_ID'. Unable to login."))

      loginResponse.nucleusId = match[1]

      getShards()
    })
  }

  function getShards () {
    defaultRequest = defaultRequest.defaults({
      json: true,
      headers: {
        'Easw-Session-Data-Nucleus-Id': loginResponse.nucleusId,
        'X-UT-Embed-Error': true,
        'X-UT-Route': 'https://utas.fut.ea.com',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': urls.referer
      }
    })

    defaultRequest.get(urls.login.shards, function (error, responsse, body) {
      if (error) return loginDetails.loginCb(error)

      if (!body || !body.shardInfo) return loginDetails.loginCb(new Error('Unable to get shards. Unable to login.'))

      loginResponse.shardInfos = body.shardInfo

      getAccount()
    })
  }

  function getAccount () {
    loginResponse.shard = __.find(loginResponse.shardInfos, function (si) {
      return si.skus.indexOf(loginDetails.gameSku) >= 0
    })

    if (!loginResponse.shard) return loginDetails.loginCb(new Error('Unable to find shardInfo.'))

    defaultRequest = defaultRequest.defaults({
      headers: {
        'X-UT-Route': 'https://' + loginResponse.shard.clientFacingIpPort
      }
    })

    defaultRequest.get(urls.login.accounts, function (error, response, body) {
      if (error) return loginDetails.loginCb(error)

      if (!body.userAccountInfo) return loginDetails.loginCb(new Error('Unable to get account infos.'))

      loginResponse.persona = body.userAccountInfo.personas[0]

      getSession()
    })
  }

  function getSession () {
    var data = {
      'isReadOnly': false,
      'sku': 'FUT16WEB',
      'clientVersion': 1,
      'nucleusPersonaId': loginResponse.persona.personaId,
      'nucleusPersonaDisplayName': loginResponse.persona.personaName,
      'gameSku': loginDetails.gameSku,
      'nucleusPersonaPlatform': getPlatform(loginDetails.platform),
      'locale': 'en-GB',
      'method': 'authcode',
      'priorityLevel': 4,
      'identification': {'authCode': ''}
    }

    defaultRequest.post(urls.login.session, { body: data }, function (error, response, body) {
      if (error) return loginDetails.loginCb(error)

      loginResponse.sessionData = body

      if (loginResponse.sessionData.sid) return phishing()

      loginDetails.loginCb(new Error(`Unknown response. Unable to login. ${response.statusCode} ${JSON.stringify(body)}`))
    })
  }

  function phishing () {
    defaultRequest = defaultRequest.defaults({
      headers: {
        'X-UT-SID': loginResponse.sessionData.sid
      }
    })

    defaultRequest.get(urls.login.question, function (error, response, body) {
      if (error) return loginDetails.loginCb(error)

      if (utils.isApiMessage(body) && body.token) {
        loginResponse.token = body.token
        loginResponse.apiRequest = defaultRequest.defaults({
          baseUrl: 'https://' + loginResponse.sessionData.ipPort.split(':')[0],
          headers: {
            'X-UT-PHISHING-TOKEN': loginResponse.token,
            'X-HTTP-Method-Override': 'GET',
            'X-UT-Route': 'https://' + loginResponse.sessionData.ipPort.split(':')[0],
            'x-flash-version': '20,0,0,272'
          }
        })

        return loginDetails.loginCb(null, loginResponse)
      }

      if (body.question) return validate()
      else if (body.code === '459') {
        // validate captcha
        // then do the phishing() again
        getCaptcha((err, rawCaptcha) => {
          if (err) loginDetails.loginCb(err)
          loginDetails.captchaCb(rawCaptcha, (captcha) => {
            validateCaptcha(captcha, (err) => {
              if (err) loginDetails.loginCb(err)
              return phishing()
            })
          })
        })
      } else loginDetails.loginCb(new Error('Unknown response. Unable to login.'))
    })
  }

  function getCaptcha (cb) {
    const url = urls.login.captchaImg + new Date().getTime()
    defaultRequest.get({
      url,
      encoding: null
    }, function (error, response, body) {
      if (error) return cb(error)
      if (response.statusCode !== 200) return cb(new Error(`Captcha error ${response.statusCode} ${body}`))
      cb(null, body)
    })
  }

  function validateCaptcha (captcha, cb) {
    const url = urls.login.validateCaptcha
    defaultRequest.post(url, {
      json: true,
      body: {
        'token': 'AAAA',
        'answer': captcha
      }
    }, (error, response, body) => {
      if (error) return cb(error)
      if (response.statusCode !== 200) return cb(new Error(`Captcha is not ok ${response.statusCode} ${body}`))
      cb()
    })
  }

  function validate () {
    defaultRequest.post(urls.login.validate, {
      form: { answer: loginDetails.secret }
    }, function (error, response, body) {
      if (error) return loginDetails.loginCb(error)

      if (!body) return loginDetails.loginCb(new Error('Unknown response. Unable to login.'))

      if (body.string !== 'OK') return loginDetails.loginCb(new Error('Wrong secret. Unable to login.'))

      if (body.string === 'OK') loginResponse.token = body.token

      if (!loginResponse.token) return loginDetails.loginCb(new Error('Unknown response. Unable to login.'))

      loginResponse.apiRequest = defaultRequest.defaults({
        baseUrl: 'https://' + loginResponse.sessionData.ipPort.split(':')[0],
        headers: {
          'X-UT-PHISHING-TOKEN': loginResponse.token,
          'X-HTTP-Method-Override': 'GET',
          'X-UT-Route': 'https://' + loginResponse.sessionData.ipPort.split(':')[0],
          'x-flash-version': '20,0,0,272',
          'Accept': 'application/json'
        }
      })

      loginDetails.loginCb(null, loginResponse)
    })
  }

  return new Login()
}