import { fetchFile } from "/node_modules/@ffmpeg/util/dist/esm/index.js";
import { FFmpeg } from "/node_modules/@ffmpeg/ffmpeg/dist/esm/index.js";

import mime from "/node_modules/mime/dist/src/index.js";

let ffmpeg;

const supportedFormats = [];

async function init () {

  ffmpeg = new FFmpeg();

  await ffmpeg.load({
    coreURL: "/node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js",
  });

  let stdout = "";
  const readStdout = ({ message }) => stdout += message + "\n";

  const getMuxerDetails = async (muxer) => {

    stdout = "";
    ffmpeg.on("log", readStdout);
    await ffmpeg.exec(["-hide_banner", "-h", "muxer=" + muxer]);
    ffmpeg.off("log", readStdout);

    return {
      extension: stdout.split("Common extensions: ")[1].split(".")[0].split(",")[0],
      mimeType: stdout.split("Mime type: ")[1].split(".")[0]
    };

  }

  stdout = "";
  ffmpeg.on("log", readStdout);
  await ffmpeg.exec(["-formats", "-hide_banner"]);
  ffmpeg.off("log", readStdout);

  const lines = stdout.split(" --\n")[1].split("\n");

  for (let line of lines) {

    let len;
    do {
      len = line.length;
      line = line.replaceAll("  ", " ");
    } while (len !== line.length);
    line = line.trim();

    const parts = line.split(" ");
    if (parts.length < 2) continue;

    const flags = parts[0];
    const description = parts.slice(2).join(" ");
    const formats = parts[1].split(",");

    for (const format of formats) {

      let extension, mimeType;
      try {
        const details = await getMuxerDetails(formats[0]);
        extension = details.extension;
        mimeType = details.mimeType;
      } catch {
        extension = format;
        mimeType = mime.getType(format) || ("video/" + format);
      }

      supportedFormats.push({
        name: description + (formats.length > 1 ? (" / " + format) : ""),
        format,
        extension,
        mime: mimeType,
        from: flags.includes("D"),
        to: flags.includes("E"),
        internal: format
      });

    }

  }

  // ====== Manual fine-tuning ======

  const prioritize = ["webm", "mp4", "gif"];
  prioritize.reverse();

  supportedFormats.sort((a, b) => {
    const priorityIndexA = prioritize.indexOf(a.format);
    const priorityIndexB = prioritize.indexOf(b.format);
    return priorityIndexB - priorityIndexA;
  });

  // AV1 doesn't seem to be included in WASM FFmpeg
  supportedFormats.splice(supportedFormats.findIndex(c => c.mime === "image/avif"), 1);

  await ffmpeg.terminate();

}

async function doConvert (inputFiles, inputFormat, outputFormat, retryWithArgs = null) {

  await ffmpeg.load();

  let stdout = "";
  const readStdout = ({ message }) => stdout += message + "\n";

  for (const file of inputFiles) {
    await ffmpeg.writeFile(file.name, new Uint8Array(file.bytes));
  }
  const listString = inputFiles.map((f, i) => `file '${f.name}'`).join("\n");
  await ffmpeg.writeFile("list.txt", new TextEncoder().encode(listString));

  const command = ["-hide_banner", "-f", "concat", "-safe", "0", "-i", "list.txt", "-f", outputFormat.internal];
  if (retryWithArgs) command.push(...retryWithArgs);
  command.push("output");

  ffmpeg.on("log", readStdout);
  await ffmpeg.exec(command);
  ffmpeg.off("log", readStdout);

  for (const file of inputFiles) {
    await ffmpeg.deleteFile(file.name);
  }

  if (stdout.includes("Conversion failed!\n")) {

    if (!retryWithArgs) {
      if (stdout.includes("Valid sizes are")) {
        const newSize = stdout.split("Valid sizes are ")[1].split(".")[0].split(" ").pop();
        return doConvert(inputFiles, inputFormat, outputFormat, ["-s", newSize]);
      }
    }

    throw stdout;
  }

  const bytes = new Uint8Array((await ffmpeg.readFile("output"))?.buffer);
  await ffmpeg.deleteFile("output");
  await ffmpeg.terminate();

  const baseName = inputFiles[0].name.split(".")[0];
  const name = baseName + "." + outputFormat.extension;

  return [{ bytes, name }];

}

export default {
  name: "FFmpeg",
  init,
  supportedFormats,
  doConvert
};
