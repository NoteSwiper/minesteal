const Queue = require('better-queue');
const { globSync } = require('glob');
const path = require('path');


q = new Queue(function (queue,cb) {
	queue.forEach(pathi => {
		console.log(pathi);
		cb();
	});
},{
	batchSize: 32,
	concurrent: 2,
	afterProcessDelay: 900,
});

let pathes = globSync("I:/mc-datas/skins/**/*.png");
pathes.forEach(pathi => {
	q.push(pathi);
});