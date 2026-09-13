import { registerSW } from 'virtual:pwa-register';

export interface PwaUpdateController {
  readonly update: (reloadPage?: boolean) => Promise<void>;
}

export function registerPwa(onNeedRefresh: (controller: PwaUpdateController) => void): void {
  const update = registerSW({
    immediate: true,
    onNeedRefresh() {
      onNeedRefresh({ update });
    },
    onOfflineReady() {
      console.info('QBT is ready for offline use.');
    },
    onRegisterError(error: unknown) {
      console.error('Service worker registration failed', error);
    },
  });
}
