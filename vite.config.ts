import { defineConfig, type Plugin } from "vite-plus";
import stockCandlesHandler from "./api/stock-candles";
import stockBatchQuotesHandler from "./api/stock-batch-quotes";

function stockApiDevPlugin(): Plugin {
  return {
    name: "stock-api-dev",
    configureServer(server) {
      server.middlewares.use("/api/stock-candles", (req, res) => {
        void stockCandlesHandler(req, res);
      });
      server.middlewares.use("/api/stock-batch-quotes", (req, res) => {
        void stockBatchQuotesHandler(req, res);
      });
    },
  };
}

export default defineConfig({
  plugins: [stockApiDevPlugin()],
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
});
