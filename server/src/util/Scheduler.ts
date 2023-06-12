/** Helper class that rate-limits how often it's handler is called */
export class Scheduler {
  shortCooldownActive = false
  longCooldownActive = false

  scheduledDuringLongCooldown = false

  constructor (
    readonly handler: () => void,
    /**
     * The fastest time that `handler` can be called after `schedule` in milliseconds.
     * Used to buffer events without creating too much delay.
     */
    readonly initialDelay: number,
    /**
     * The minimum amount of time in milliseconds between calls of `handler`.
     */
    readonly repeatDelay: number,
  ) {}

  schedule (): void {
    if (this.shortCooldownActive) return

    if (this.longCooldownActive) {
      this.scheduledDuringLongCooldown = true
    } else {
      this.shortCooldownActive = true
      this.longCooldownActive = true
      setTimeout(this.shortCooldownExpire, this.initialDelay)
      setTimeout(this.longCooldownExpire, this.repeatDelay)
    }
  }

  private readonly shortCooldownExpire = (): void => {
    this.shortCooldownActive = false
    this.handler()
  }

  private readonly longCooldownExpire = (): void => {
    if (this.scheduledDuringLongCooldown) {
      this.handler()
      this.scheduledDuringLongCooldown = false
      setTimeout(this.longCooldownExpire, this.repeatDelay)
    } else {
      this.longCooldownActive = false
    }
  }
}
