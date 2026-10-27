/** mammoth's prebuilt browser bundle has the same API as the package's typed entry point. */
declare module "mammoth/mammoth.browser.js" {
  import mammoth = require("mammoth");
  export default mammoth;
}
