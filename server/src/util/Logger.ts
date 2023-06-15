const DEFAULT_VOID = (): void => {}

export class Logger {
  static enable (logger: Logger): void {
    logger.bind('log')
    logger.bind('info')
    logger.bind('warn')
    logger.bind('error')
    logger.bind('trace')
  }

  private bind (key: keyof Logger, keyStr?: string): void {
    (this as any)[key] = keyStr != null ? (console as any)[key].bind(console, keyStr) : (console as any)[key].bind(console)
  }

  public log: typeof console.log = DEFAULT_VOID
  public info: typeof console.info = DEFAULT_VOID
  public warn: typeof console.warn = DEFAULT_VOID
  public error: typeof console.error = DEFAULT_VOID
  public trace: typeof console.trace = DEFAULT_VOID
}

export const LOG = {
  general: new Logger(),
  fileLoading: new Logger(),
} as const

Logger.enable(LOG.general)
Logger.enable(LOG.fileLoading)
