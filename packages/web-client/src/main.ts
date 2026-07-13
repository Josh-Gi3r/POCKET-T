import { mount } from 'svelte';
import { registerSW } from 'virtual:pwa-register';
import './app.css';
import App from './App.svelte';

// Auto-update the service worker in the background; no user prompt needed.
registerSW({ immediate: true });

const app = mount(App, { target: document.getElementById('app')! });

export default app;
