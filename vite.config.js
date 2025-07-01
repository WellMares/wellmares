import { defineConfig } from 'vite'
import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig({
    plugins: [cloudflare({
        auxiliaryWorkers: [{
            configPath: './src/firebase-token-service/wrangler.jsonc',
        }],
    })],
    server: {
        watch: {
            usePolling: true,
            interval: 1000,
        },
    },
        
})