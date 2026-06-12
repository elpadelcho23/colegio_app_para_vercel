declare module '*.css';
declare module '*.scss';
declare module '*.sass';

declare module 'virtual:pwa-register' {
    interface RegisterSWOptions {
        immediate?: boolean;
        onNeedRefresh?: () => void;
        onOfflineReady?: () => void;
    }

    export function registerSW(options?: RegisterSWOptions): void;
}

declare namespace App {
    interface Locals {
        user: import('./server/db').User | null;
    }
}
