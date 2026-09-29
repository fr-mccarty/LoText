// A question the model needs to ask, queued so that two of them never fight over the screen.
//
// The alerts themselves are the platform's own, asked through the main process, because a
// question about losing text should look like every other question the system asks.

export class Alerts {
  constructor (bridge) {
    this.bridge = bridge
    this.queue = []
    this.isShowing = false
  }

  /**
   * @param {{title:string,message:string,buttons:Array<{title:string,action?:Function,destructive?:boolean}>}} alert
   * @returns {Promise<number>} which button was chosen.
   */
  present (alert) {
    return new Promise((resolve) => {
      this.queue.push({ alert, resolve })
      this.pump()
    })
  }

  error (title, message) {
    return this.present({ title, message, buttons: [{ title: 'OK' }] })
  }

  async pump () {
    if (this.isShowing || !this.queue.length) return
    this.isShowing = true
    const { alert, resolve } = this.queue.shift()
    let chosen = 0
    try {
      chosen = await this.bridge.ask({
        type: alert.type ?? 'warning',
        title: alert.title,
        message: alert.message,
        buttons: alert.buttons.map((button) => button.title),
        defaultId: 0,
        cancelId: alert.buttons.findIndex((button) => button.cancel) ?? alert.buttons.length - 1,
      })
    } catch {
      chosen = alert.buttons.length - 1
    }
    this.isShowing = false
    resolve(chosen)
    try {
      await alert.buttons[chosen]?.action?.()
    } finally {
      this.pump()
    }
  }
}
