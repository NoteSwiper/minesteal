const got = require("got");
const Queue = require("better-queue");
const { randomUUID } = require("crypto");
const fs = require("fs");
const path = require("path");
const log4js = require("log4js");
const { Command } = require("commander");
const program = new Command();
const clui = require("clui");
const dotenv = require("dotenv");
let lenlist = Array(32).fill(0);

let isd = false;

if (fs.existsSync(".env")) {
  isd = true;
  dotenv.config();
} else {
  isd = false;
}
const VERSIONAPP = "1.0.0";

program
  .name("minesteal")
  .description("A program for getting mineskin skins.")
  .version(VERSIONAPP, "-v, --version", "outputs the current version");

/*
batchSize: 32,
    maxRetries: 32,
    afterProcessDelay: 500,
    concurrent: 3,
    retryDelay: 2500,
*/

program
  .option("-p, --pages <number>", "pages for randomly loading the pages", "500")
  .option(
    "-l, --loaddelay <milliseconds>",
    "make a delay before loading",
    "500"
  )
  .option("-r, --retries <number>", "set maxRetries in queue", "32")
  .option(
    "-a, --processdelay <milliseconds>",
    "set afterProcessDelay in queue",
    "500"
  )
  .option("-c, --concurrent <workers>", "set concurrent workers", "3")
  .option("-d, --retrydelay <milliseconds>", "set retryDelay in queue", "2500")
  .option("-b, --batches <batch>", "set batch size in queue", "32")
  .option(
    "-s, --path <path>",
    "set save directory for skins",
    path.resolve(isd === true ? process.env.SAVE_DIR : "skins/")
  )
  .option(
    "-o, --logpath <path>",
    "set log directory for reporting issue [experimental]",
    path.resolve(__dirname, "logs/")
  )
  .option(
    "-A, --apikey <key>",
    "set Bearer Authorization key for MineSkin (currently Unused)",
    ""
  );

program.parse();

const opts = program.opts();

const downloadFolder = path.resolve(opts.path);

const PAGES_TO_LOAD = parseFloat(opts.pages);
const LOAD_DELAY = parseInt(opts.loaddelay);
const API_K = `opts.apikey`;

log4js.configure({
  appenders: {
    out: {
      type: "file",
      filename: path.resolve(opts.logpath, "output.log"),
      maxLogSize: 10485760,
      backups: 10,
      compress: true,
      keepFileExt: true,
    },
    multi: {
      type: "multiFile",
      base: path.resolve(opts.logpath),
      property: "categoryName",
      extension: ".log",
      maxLogSize: 10485760,
      backups: 10,
      compress: true,
      keepFileExt: true,
    },
  },
  categories: {
    default: { appenders: ["multi", "out"], level: "trace" },
  },
});
const logger = log4js.getLogger();
const corelog = log4js.getLogger("core");
const datalog = log4js.getLogger("data");
const queuelog = log4js.getLogger("queue");

corelog.trace("Log4JS Logger initialized");
corelog.trace(`minesteal v${VERSIONAPP}`);

corelog.trace("Checking download path exists...");
if (!fs.existsSync(downloadFolder)) {
  corelog.trace(`Path "${downloadFolder}" doesn't exists. creating...`);
  fs.mkdirSync(downloadFolder);
}
if (!fs.existsSync(opts.logpath)) {
  corelog.trace(`Path "${opts.logpath}" doesn't exists. creating...`);
  fs.mkdirSync(opts.logpath);
}

const instance = got.extend({
  prefixUrl: "https://api.mineskin.org",
  headers: {
    "user-agent": "MCPV2/1.2",
  },
  resolveBodyOnly: true,
  throwHttpErrors: false,
});
const instance2 = got.extend({
  headers: { "user-agent": "MCPV2/1.2" },
  resolveBodyOnly: true,
  throwHttpErrors: false,
});

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function sendData(taskid, taskstatus, taskmessage, taskstats) {
  const json = {
    id: taskid,
    status: taskstatus,
    message: taskmessage,
    stats: taskstats ?? null,
  };
  datalog.debug(JSON.stringify(json));
}

let PROCESSED_BATCHES = 0;
let PROCESSED_TASKS = 0;
let PROCESSED_PROCESSES = 0;

let CURRENT_BATCHES = 0;
let CURRENT_TASKS = 0;
let CURRENT_PROCESSES = 0;

q = new Queue(
  function (tasks, cb) {
    const current = this;
    queuelog.debug(`### BATCH QUEUE START ###`);
    tasks.forEach((task) => {
      queuelog.debug(`### CURRENT_QUEUE_TASK: ${task.uuid} ###`);
      const urlid = task.data.url;
      const skinId = urlid.replace(
        /https?:\/\/textures\.minecraft\.net\/texture\//gm,
        ""
      );
      queuelog.trace(`Preparing to get image "${task.data.url}"...`);
      try {
        instance2(task.data.url, { responseType: "buffer" }).then((skin) => {
          fs.writeFile(
            path.join(downloadFolder, `${skinId}.png`),
            skin,
            (err) => {
              if (err) {
                queuelog.error(
                  `Error occured while processing queue task: ${err}`
                );
                throw err;
              }
              queuelog.trace(
                `Image saved: ${path.join(downloadFolder, skinId + ".png")}`
              );
              cb(null, task.uuid);
            }
          );
        });
      } catch (err) {
        console.error(`${err}\n`);
        queuelog.error(err);
      }
      PROCESSED_PROCESSES++;
      queuelog.debug(`### PREVIOUS_QUEUE_TASK: ${task.uuid} ###`);
    });
    queuelog.debug(`### BATCH QUEUE ENDS ###`);
  },
  {
    //id: 'uuid',
    maxRetries: parseInt(opts.retries),
    afterProcessDelay: parseInt(opts.processdelay),
    concurrent: parseInt(opts.concurrent),
    retryDelay: parseInt(opts.retrydelay),
    batchSize: parseInt(opts.batches),
    filter: function (input, cb) {
      queuelog.trace(`Queue filtering process`);
      if (
        fs.existsSync(
          path.join(
            downloadFolder,
            `${input.data.url.replace(
              /https?:\/\/textures\.minecraft\.net\/texture\//gm,
              ""
            )}.png`
          )
        )
      ) {
        queuelog.trace(`Queue filtering process Failure: Already downloaded`);
        return cb("already_downloaded");
      }
      queuelog.trace(`Queue filtering process Success`);
      return cb(null, input);
    },
  }
);

let REMAINING_SKINS = 0;
let PROCESSING_SKINS = 0;

q.on("task_queued", function (task_id) {
  REMAINING_SKINS++;
  sendData(task_id, "queued", "", {});
});
q.on("task_accepted", function (task_id) {
  sendData(task_id, "accepted", "", {});
});
q.on("task_started", function (task_id) {
  REMAINING_SKINS--;
  PROCESSING_SKINS++;
  sendData(task_id, "started", "", {});
});
q.on("task_finish", function (task_id, result, stats) {
  PROCESSING_SKINS--;
  sendData(task_id, "success", result, stats);
  PROCESSED_TASKS++;
});
q.on("task_failed", function (task_id, error, stats) {
  PROCESSING_SKINS--;
  logger.warn(`${task_id} - Failed: ${error}`);
  sendData(task_id, "failure", error, stats);
});
q.on("task_progress", function (task_id, c, t) {
  logger.info(`${task_id} - ${c}/${t}`);
  sendData(task_id, "progress", null, { current: c, total: t });
});
q.on("batch_finish", function () {
  PROCESSED_BATCHES++;
});

process.stdout.write(
  `Please wait for ${
    LOAD_DELAY / 1000
  } seconds to warming up the process...\n\n\n\n`
);
const ob = new clui.LineBuffer({
  x: 0,
  y: 0,
  width: "console",
  height: "console",
});
logger.info(
  `Please wait for ${LOAD_DELAY / 1000} seconds to warming up the process...`
);
setInterval(async function () {
  for (let ts = 0; ts < 4; ts++) {
    const index = Math.floor(Math.random() * PAGES_TO_LOAD);
    corelog.trace(`Preparing to get "/get/list/${index}"...`);
    instance
      .get(`get/list/${index}`)
      .then((res) => {
        corelog.trace("Success");
        const json = JSON.parse(res).skins;
        json.forEach((skin) => {
          corelog.trace(`Input: ${JSON.stringify(skin)}`);
          q.push({ uuid: randomUUID(), data: skin }, function (err, result) {
            if (err) {
              corelog.error(`Got error: ${err}`);
            } else {
              corelog.info(`Got result: ${result}`);
            }
          });
        });
      })
      .catch((err) => {
        corelog.error(`Got Error: ${err}`);
      });
  }
}, LOAD_DELAY);

let bpslist = lenlist;
let tpslist = lenlist;
let ppslist = lenlist;

const clearLines = async (n) => {
  for (let i = 0; i < n; i++) {
    const y = i === 0 ? null : -1;
    process.stdout.moveCursor(0, y);
    process.stdout.clearLine(1);
  }
  process.stdout.cursorTo(0);
};
setInterval(async function () {
  clearLines(1);
  var stats = q.getStats();
  process.stdout.write(
    `SKINS: ${stats.total} stored / ${REMAINING_SKINS} in-queue / ${PROCESSING_SKINS} processing`
  );
}, 50);
