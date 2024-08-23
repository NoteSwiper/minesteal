const { extend } = require('got');
const Queue = require('better-queue');
const { randomFillSync, randomUUID } = require('crypto');
const { existsSync, mkdirSync, writeFile } = require('fs');
const { resolve, join } = require('path');
const { configure, getLogger } = require('log4js');
const { Command } = require('commander');
const { config } = require('dotenv');
const { Database} = require("sqlite3");
const program = new Command();
let isd = (existsSync('.env')) ? true : false; isd && config();
const VERSIONAPP = '1.0.0';
let af = false;
program
	.name('minesteal')
	.description('A program for getting mineskin skins.')
	.version(VERSIONAPP, '-v, --version', 'outputs the current version');
program
	.option(
		'-p, --pages <number>',
		'pages for randomly loading the pages',
		'500'
	)
	.option(
		'-l, --loaddelay <milliseconds>',
		'make a delay before loading',
		'500'
	)
	.option('-r, --retries <number>', 'set maxRetries in queue', '32')
	.option(
		'-a, --processdelay <milliseconds>',
		'set afterProcessDelay in queue',
		'500'
	)
	.option('-c, --concurrent <workers>', 'set concurrent workers', '3')
	.option(
		'-d, --retrydelay <milliseconds>',
		'set retryDelay in queue',
		'2500'
	)
	.option('-b, --batches <batch>', 'set batch size in queue', '32')
	.option(
		'-s, --path <path>',
		'set save directory for skins',
		resolve(isd === true ? process.env.SAVE_DIR : 'skins/mineskin/')
	)
	.option(
		'-B, --dbpath <path>',
		'set database file path for saving the skin info,',
		resolve('./database.sqlite3')
	)
	.option(
		'-o, --logpath <path>',
		'set log directory for reporting issue [experimental]',
		resolve(__dirname, 'logs/')
	)
	.option(
		'-A, --apikey <key>',
		'set Bearer Authorization key for MineSkin (currently Unused)',
		''
	);

program.parse();

const opts = program.opts();

const downloadFolder = resolve(opts.path);
const db = new Database(join(opts.dbpath), (err) => {
	(err) && console.error(err.message);
});

const PAGES_TO_LOAD = parseFloat(opts.pages);
const LOAD_DELAY = parseInt(opts.loaddelay);
/* const API_K = `opts.apikey` */
configure({
	appenders: {
		out: {
			type: 'file',
			filename: resolve(opts.logpath, 'output.log'),
			maxLogSize: 10485760,
			backups: 10,
			compress: true,
			keepFileExt: true,
		},
		multi: {
			type: 'multiFile',
			base: resolve(opts.logpath),
			property: 'categoryName',
			extension: '.log',
			maxLogSize: 10485760,
			backups: 10,
			compress: true,
			keepFileExt: true,
		},
	},
	categories: {
		default: { appenders: ['multi', 'out'], level: 'trace' },
	},
});
const logger = getLogger();
const corelog = getLogger('core');
const datalog = getLogger('data');
const queuelog = getLogger('queue');

corelog.trace('Log4JS Logger initialized');
corelog.trace(`minesteal v${VERSIONAPP}`);

corelog.trace('Checking download path exists...');
if (!existsSync(downloadFolder)) {
	corelog.trace(`Path "${downloadFolder}" doesn't exists. creating...`);
	mkdirSync(downloadFolder);
}
if (!existsSync(opts.logpath)) {
	corelog.trace(`Path "${opts.logpath}" doesn't exists. creating...`);
	mkdirSync(opts.logpath);
}

const instance = extend({
	prefixUrl: 'https://api.mineskin.org',
	headers: {
		'user-agent': 'MCPV2/1.2',
	},
	resolveBodyOnly: true,
	throwHttpErrors: false,
});
const instance2 = extend({
	headers: { 'user-agent': 'MCPV2/1.2' },
	resolveBodyOnly: true,
	throwHttpErrors: false,
});

//const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const sendData = async (taskid, taskstatus, taskmessage, taskstats) => {
	const json = {id: taskid, status: taskstatus,	message: taskmessage, stats: taskstats ?? null, };
	datalog.debug(JSON.stringify(json));
}

var q = new Queue(
	function (tasks, cb) {
		//const current = this
		queuelog.debug(`### BATCH QUEUE START ###`);
		tasks.forEach((task) => {
			queuelog.debug(`### CURRENT_QUEUE_TASK: ${task.uuid} ###`);
			const urlid = task.data.url;
			const skinId = urlid.replace(
				/https?:\/\/textures\.minecraft\.net\/texture\//gm,
				''
			);
			queuelog.trace(`Preparing to get image "${task.data.url}"...`);
			try {
				instance2(task.data.url, { responseType: 'buffer' }).then(
					(skin) => {
						writeFile(
							join(downloadFolder, `${skinId}.png`),
							skin,
							(err) => {
								if (err) {
									queuelog.error(
										`Error occured while processing queue task: ${err}`
									);
									throw err;
								}
								queuelog.trace(
									`Image saved: ${join(downloadFolder, skinId + '.png')}`
								);
								var aa = randomUUID();
								db.serialize(() => {
									db.run(
										'CREATE TABLE IF NOT EXISTS "mineskin" ("id"	INTEGER,"name"	TEXT,"suid"	TEXT,"hash"	TEXT,"uuid"	TEXT,"time"	NUMERIC,"path"	TEXT,"version"	TEXT,CONSTRAINT "uniq" PRIMARY KEY("id"));'
									);
									db.run(
										'INSERT OR IGNORE INTO mineskin VALUES (?,?,?,?,?,?,?,?)',
										task.data.id,
										task.data.name ?? randomUUID(),
										task.data.skinUuid ?? aa,
										skinId ?? Array.from(randomFillSync(new Uint8Array(16))).map((n)=>5[n%'abcdef0123456789'.length]).join(''),
										task.data.uuid ?? aa,
										task.data.time,
										join(downloadFolder, `${skinId}.png`),
										VERSIONAPP
									);
								});
								cb(null, task.uuid);
							}
						);
					}
				);
			} catch (err) {
				console.error(`${err}\n`);
				queuelog.error(err);
			}
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
				existsSync(
					join(
						downloadFolder,
						`${input.data.url.replace(
							/https?:\/\/textures\.minecraft\.net\/texture\//gm,
							''
						)}.png`
					)
				)
			) {
				queuelog.trace(
					`Queue filtering process Failure: Already downloaded`
				);
				return cb('already_downloaded');
			}
			queuelog.trace(`Queue filtering process Success`);
			return cb(null, input);
		},
	}
);

let REMAINING_SKINS = 0;
let PROCESSING_SKINS = 0;
let STATISTICS = [0, 0];

q.on('task_queued', function (task_id) {
	REMAINING_SKINS++;
	sendData(task_id, 'queued', '', {});
});
q.on('task_accepted', function (task_id) {
	sendData(task_id, 'accepted', '', {});
});
q.on('task_started', function (task_id) {
	REMAINING_SKINS--;
	PROCESSING_SKINS++;
	sendData(task_id, 'started', '', {});
});
q.on('task_finish', function (task_id, result, stats) {
	PROCESSING_SKINS--;
	sendData(task_id, 'success', result, stats);
	STATISTICS[1]++;
});
q.on('task_failed', function (task_id, error, stats) {
	PROCESSING_SKINS--;
	logger.warn(`${task_id} - Failed: ${error}`);
	sendData(task_id, 'failure', error, stats);
});
q.on('task_progress', function (task_id, c, t) {
	logger.info(`${task_id} - ${c}/${t}`);
	sendData(task_id, 'progress', null, { current: c, total: t });
});
q.on('batch_finish', function () {
	STATISTICS[0]++;
});

process.stdout.write(
	`Please wait for ${
		LOAD_DELAY / 1000
	} seconds to warming up the process...\n\n\n\n`
);
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
				corelog.trace('Success');
				const json = JSON.parse(res).skins;
				json.forEach((skin) => {
					corelog.trace(`Input: ${JSON.stringify(skin)}`);
					q.push(
						{ uuid: randomUUID(), data: skin },
						function (err, result) {
							if (err) {
								corelog.error(`Got error: ${err}`);
							} else {
								corelog.info(`Got result: ${result}`);
							}
						}
					);
				});
			})
			.catch((err) => {
				corelog.error(`Got Error: ${err}`);
			});
	}
}, LOAD_DELAY);
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
process.on('beforeExit', (code) => {
	if (!af) return;
	af = true;
	setTimeout(() => {
		db.close();
		console.log('Process exit: ', code);
	})
});