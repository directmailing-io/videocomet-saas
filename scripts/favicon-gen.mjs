import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
const svg = readFileSync("public/logo-mark.svg");
// 32x32 ICO-substitute (PNG named favicon.ico works fine in modern browsers)
const png = await sharp(svg, { density: 320 }).resize(64, 64, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer();
writeFileSync("public/favicon.ico", png);
writeFileSync("public/apple-icon.png", await sharp(svg, { density: 600 }).resize(180, 180, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } }).png().toBuffer());
writeFileSync("public/icon.png", await sharp(svg, { density: 320 }).resize(192, 192, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } }).png().toBuffer());
console.log("ok");
