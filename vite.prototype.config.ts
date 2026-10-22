import { defineConfig } from 'vite'
export default defineConfig({ build: { outDir: 'dist-prototype', rollupOptions: { input: 'prototype.html' } } })
