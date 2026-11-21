// 构建静态站：把 webapp/src 打包到 Android 工程的 assets/web。
// 用法（在 webapp 目录）：pnpm install && pnpm build:web
// 依赖说明：@rspack/* 需要本目录（或上级目录）能解析到 node_modules，见 webapp/package.json。
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rspack } from '@rspack/core'

process.env.NODE_ENV = 'production'

const WEBAPP = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(WEBAPP, 'src')
const OUT = path.resolve(WEBAPP, '..', 'app/src/main/assets/web')
// 可选：构建时内置的官方地址；应用里可在「模型设置」中覆盖
const apiOrigin = process.env.CHAT_API_ORIGIN || 'https://api.deepseek.com'

const { version } = JSON.parse(readFileSync(path.join(WEBAPP, 'package.json'), 'utf8'))
const targets = ['chrome >= 105', 'edge >= 105', 'safari >= 16', 'firefox >= 110']
const cssLoader = { loader: 'builtin:lightningcss-loader', options: { targets } }

/** @type {import('@rspack/core').Configuration} */
export default {
  mode: 'production',
  context: WEBAPP,
  entry: path.join(SRC, 'main.tsx'),
  output: {
    path: OUT,
    publicPath: 'auto',
    filename: 'static/js/[name].[contenthash:8].js',
    chunkFilename: 'static/js/async/[name].[contenthash:8].js',
    cssFilename: 'static/css/[name].[contenthash:8].css',
    cssChunkFilename: 'static/css/async/[name].[contenthash:8].css',
    assetModuleFilename: 'static/media/[name].[contenthash:8][ext]',
    clean: true,
  },
  devtool: false,
  lazyCompilation: false,
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    extensionAlias: { '.js': ['.ts', '.tsx', '.js'] },
  },
  module: {
    parser: { 'css/module': { namedExports: false } },
    generator: { 'css/module': { localIdentName: '[local]-[hash:6]' } },
    rules: [
      { test: /\.module\.css$/, type: 'css/module', use: [cssLoader] },
      { test: /\.css$/, exclude: /\.module\.css$/, type: 'css', use: [cssLoader] },
      {
        test: /\.(j|t)sx?$/,
        exclude: /[\\/]node_modules[\\/]/,
        loader: 'builtin:swc-loader',
        options: {
          jsc: {
            parser: { syntax: 'typescript', tsx: true },
            transform: { react: { runtime: 'automatic', development: false } },
            externalHelpers: true,
          },
          env: { targets },
        },
        type: 'javascript/auto',
      },
      { test: /\.(woff2?|ttf)$/, type: 'asset/resource' },
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: path.join(SRC, 'index.html'),
      scriptLoading: 'defer',
      meta: { 'application-version': version },
    }),
    new rspack.DefinePlugin({ __API_ORIGIN__: JSON.stringify(apiOrigin) }),
  ],
  performance: { hints: false },
}


