import * as Magick from "/node_modules/wasm-imagemagick/dist/magickApi.js";

import mime from "/node_modules/mime/dist/src/index.js";

const supportedFormats = [];

async function init () {

  const listFormats = await Magick.call([], ["convert", "-list", "format"]);
  const listDelegates = await Magick.call([], ["convert", "-list", "delegate"]);

  const delegates = listDelegates.stdout.slice(5)
    .map(c => c.slice(0, c.indexOf("=") + 3))
    .map(c => ({
      format: c.slice(0, -4).split(":")[0].trim(),
      from: c[c.length - 2] !== ">",
      to: c[c.length - 4] !== " " || c[0] !== " "
    }));

  for (let i = 0; i < delegates.length; i ++) {
    const delegate = delegates[i];
    const duplicates = delegates.filter(c =>
      c.format === delegate.format && c !== delegate);
    if (duplicates.some(c => !c.from)) delegate.from = false;
    if (duplicates.some(c => !c.to)) delegate.to = false;
    for (const duplicate of duplicates) {
      delegates.splice(delegates.indexOf(duplicate), 1);
    }
  }

  const lines = listFormats.stdout.slice(2).map(c => c.trim());
  for (let line of lines) {

    let len;
    do {
      len = line.length;
      line = line.replaceAll("  ", " ");
    } while (len !== line.length);

    const parts = line.split(" ");
    if (parts.length < 2) continue;

    const format = parts[0].toLowerCase().replace("*", "");
    const flags = parts[1];
    const description = parts.slice(2).join(" ");

    const delegate = delegates.find(c => c.format === format);
    if (delegate && !delegate.to && !delegate.from) continue;
    if (description.toLowerCase().includes("mpeg")) continue;

    if (flags.length !== 3 || (!flags.endsWith("+") && !flags.endsWith("-"))) continue;

    supportedFormats.push({
      name: description,
      format: format,
      extension: format,
      mime: mime.getType(format),
      from: (delegate && !delegate.from) ? false : flags.includes("r"),
      to: (delegate && !delegate.to) ? false : flags.includes("w"),
      internal: format,
    });

  }

  // ====== Manual fine-tuning ======

  const prioritize = ["png", "jpeg", "apng", "gif"];
  prioritize.reverse();

  supportedFormats.sort((a, b) => {
    const priorityIndexA = prioritize.indexOf(a.format);
    const priorityIndexB = prioritize.indexOf(b.format);
    return priorityIndexB - priorityIndexA;
  });

  /**
   * This entry seems to be inaccurate, but I'm not entirely sure why.
   * This is *supposed* to be "Compressed SVG", but the output is just
   * an *uncompressed* SVG containing a base64 image.
   *
   * I'm guessing that "svgz" is used to imply that this isn't a "natural"
   * SVG. However, in our case, we're not aiming for anything more than
   * that in the majorify of cases.
   */
  const svgzFormat = supportedFormats.find(c => c.format === "svgz");
  svgzFormat.name = "Scalable Vector Graphics";
  svgzFormat.format = "svg";
  svgzFormat.extension = "svg";

}

async function doConvert (inputFile, inputFormat, outputFormat, retryWithArgs = null) {

  const command = ["convert", inputFile.name];
  if (retryWithArgs) command.push(...retryWithArgs);
  command.push(`${outputFormat.internal}:out`);

  const image = { name: inputFile.name, content: new Uint8Array(inputFile.bytes) };
  const result = await Magick.call([image], command);

  if (result.exitCode !== 0) {

    if (!retryWithArgs) {
      if (result.stderr[0].includes("WidthOrHeightExceedsLimit")) {
        return await doConvert(inputFile, inputFormat, outputFormat, ["-resize", "256x256"]);
      }
    }

    throw result.stderr.join("\n");
  }

  return result.outputFiles[0].buffer;

}

export default {
  name: "ImageMagick",
  init,
  supportedFormats,
  doConvert
};
