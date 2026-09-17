/* Recovery screen — talks only through the narrow preload bridge. No raw error text. */
'use strict'
;(function () {
  var params = new URLSearchParams(window.location.search)
  document.getElementById('ref').textContent = params.get('ref') || '—'
  var bridge = window.merqo || null

  var retry = document.getElementById('retry')
  var relaunch = document.getElementById('relaunch')
  var help = document.getElementById('help')
  var msg = document.getElementById('msg')

  retry.addEventListener('click', function () {
    retry.disabled = true
    msg.textContent = 'আবার চালু করার চেষ্টা করা হচ্ছে…'
    if (!bridge || !bridge.retryStartup || !bridge.rendererAlive) {
      // bridge unavailable — a plain reload is still a valid retry
      window.location.reload()
      return
    }
    bridge.retryStartup().then(function (r) {
      if (r && r.ok) {
        msg.textContent = 'সফল — অ্যাপ্লিকেশন লোড হচ্ছে…'
        window.location.reload()
      } else {
        retry.disabled = false
        msg.textContent = 'আবারও সমস্যা হয়েছে — অ্যাপ্লিকেশন পুনরায় চালু করে দেখুন।'
      }
    }).catch(function () {
      retry.disabled = false
      msg.textContent = 'আবারও সমস্যা হয়েছে — অ্যাপ্লিকেশন পুনরায় চালু করে দেখুন।'
    })
  })

  relaunch.addEventListener('click', function () {
    if (bridge && bridge.relaunchApp) { bridge.relaunchApp(); return }
    window.location.reload()
  })

  help.addEventListener('click', function () {
    if (bridge && bridge.openLogs) { void bridge.openLogs(); return }
    msg.textContent = 'সহায়তার জন্য ইমেইল করুন: merqoonline@gmail.com'
  })
})()
