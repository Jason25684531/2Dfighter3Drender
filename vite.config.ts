import { defineConfig } from 'vite'
// Quick tunnels get a random *.trycloudflare.com host; Vite blocks unknown Host headers by default.
export default defineConfig({ server: { allowedHosts: ['.trycloudflare.com'] } })
