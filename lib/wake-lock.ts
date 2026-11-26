// Keeps a phone's screen on while a long upload runs. A locked screen suspends the page, and the
// upload with it. Browsers drop the lock whenever the page is hidden, so it is taken again on return.

// The Screen Wake Lock API, which this TypeScript's DOM types do not include yet.
interface ScreenLock {
  release(): Promise<void>
}
type WakeLockNavigator = Navigator & { wakeLock: { request(type: 'screen'): Promise<ScreenLock> } }

/** Holds the screen on until the returned function is called. Does nothing where the browser can't. */
export async function keepScreenOn(): Promise<() => void> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return () => {}
  const wakeLock = (navigator as WakeLockNavigator).wakeLock
  let lock: ScreenLock | null = null
  let released = false
  const take = async () => {
    try {
      lock = await wakeLock.request('screen')
    } catch (e) {
      // Refused in Low Power Mode, for one. The upload still runs, it just pauses if the screen locks.
      console.warn('Could not keep the screen on during the upload', e)
      lock = null
    }
  }
  const onVisible = () => {
    if (!released && document.visibilityState === 'visible') void take()
  }
  await take()
  document.addEventListener('visibilitychange', onVisible)
  return () => {
    released = true
    document.removeEventListener('visibilitychange', onVisible)
    void lock?.release()
  }
}
