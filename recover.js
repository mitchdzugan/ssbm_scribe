const http                              = require("http");
const request                           = require("request");
const { spawn, exec }                   = require("child_process");
const {
    createReadStream,
    createWriteStream,
    existsSync,
}                                       = require("fs");
const fs                                = require("fs/promises");
const { SlippiGame }                    = require("@slippi/slippi-js");
const util                              = require("util");
const config                            = require("./config.json");

const pexec = util.promisify(exec);

const dumpPath = __dirname + "\\User\\Dump\\";
const slippiExe = config.slippiExe;

const IP = "192.168.1.24";

const getGame = (path) => {
    const game = new SlippiGame(__dirname + "\\todo.slp");
    const settings = game.getSettings();
    const metadata = game.getMetadata();
    game.isMe = (n) => {
        const characterId = (((settings || {}).players || [])[n] || {}).characterId;
        const codeA = ((((settings || {}).players || [])[n] || {}).connectCode || "").toLowerCase();
        const codeB = (((((metadata || {}).players || [])[n] || {}).names || {}).code || "").toLowerCase();
        return characterId === 17 && (
            codeA === "dz#788"   || 
            codeA === "lube#420" ||
            codeB === "dz#788"   || 
            codeB === "lube#420"
        );
    };
    return game;
};

const getData = (game) => {
    const settings = game.getSettings();
    console.log(settings);
    const isSingles = settings.players.length === 2;
    const metadata = game.getMetadata();
	const mLastFrame = (metadata || {}).lastFrame;
	const cLastFrame = Math.max(...Object.keys(game.getFrames()).map(s => parseInt(s, 10)));
	const lastFrame = mLastFrame || cLastFrame;
	const stats = game.getStats();

    const is0 = game.isMe(0);
    const is1 = game.isMe(1);
    const isDitto = (
        settings.players[0].characterId === settings.players[1].characterId
    );
    const characterId = settings.players[is0 ? 1 : 0].characterId;
    const stageId = settings.stageId;
    const myIndex = is0 ? 0 : 1;
    const amIn = is0 || is1;
    const isShort = lastFrame < 60 * 30;

    let skipReason = null;
    if (!amIn) {
        skipReason = "NotInOrNotYoshi";
    } else if (isShort) {
        skipReason = "isShort";
    } else if (isDitto) {
        skipReason = "isDitto"
    } else if (!isSingles) {
        skipReason = "isDoubles";
    } else if (characterId > 25) {
        skipReason = "invalidCharacter";
    } else if (stageId < 2 || stageId > 32 || stageId === 21) {
        skipReason = "invalidStage";
    }

    if (skipReason) {
        return { isSkip: true, skipReason };
    }

    const frames = game.getFrames();
    let i = lastFrame;
    while (!frames[i].players[0].post) { console.log(i); i--; }
    const { players } = frames[i];
    const winnerIndex = !stats.gameComplete ? null : (
        players[0].post.stocksRemaining === 0 ? 1 : 0
    );
    console.log(players);
    const myEndStocks   = players[is0 ? 0 : 1].post.stocksRemaining;
    const myEndPercent  = !myEndStocks  ? 0 : players[is0 ? 0 : 1].post.percent;
    const oppEndStocks  = players[is0 ? 1 : 0].post.stocksRemaining;
    const oppEndPercent = !oppEndStocks ? 0 : players[is0 ? 1 : 0].post.percent;
    const stockData = [
        [],
        [],
    ];
    stats.stocks.forEach(({ playerIndex, count, startFrame }) => {
        stockData[playerIndex].push({ startFrame, count });
    });
    stockData[0].sort((a, b) => a.count - b.count);
    stockData[1].sort((a, b) => a.count - b.count);
    const getStock = (frame) => {
        let stock = null;
        stockData[is0 ? 1 : 0].forEach(({ startFrame, count }) => {
            if (frame < startFrame || stock) { return; }
            stock = count;
        });
        return stock || 4;
    };
    const Combos = stats.conversions
        .filter(({ playerIndex }) => playerIndex !== myIndex)
        .map(({ startFrame, endFrame, startPercent, endPercent, moves, didKill, openingType }) => ({
            startPercent,
            damage: endPercent - startPercent,
            startFrame,
            frames: endFrame - startFrame,
            didKill,
            openingType,
            stock: getStock(startFrame),
            Moves: moves.map(({ moveId, damage }, nth) => (
                { nth, moveId, damage }
            )),
        }));
    return {
        isSkip: false,
        Game: {
            characterId,
            stageId,
            lastFrame,
            myPort: settings.players[is0 ? 0 : 1].port - 1,
            myIndex,
            oppEndStocks,
            oppEndPercent,
            myEndStocks,
            myEndPercent,
            doer: config.doer,
            endResult: (
                !stats.gameComplete ? 5 : (winnerIndex === myIndex ? 1 : 0)
            )
        },
        Combos,
    };
};

const main = async () => {
    // CLEAN
    // PREPARE
    // const slpFile = process.argv[2];
    const filename = 'Game_20210421T081841'; // TODO
    const game = getGame(__dirname + "\\todo.slp");
    const DATA = getData(game);

    console.log(DATA);
    const wrapUp = async () => {
        console.log("preview...");
        await pexec(
            `ffmpeg -i "${__dirname}\\User\\Dump\\Frames\\framedump0.avi" -an -s hd720 -pix_fmt yuv420p -preset slow -profile:v baseline -movflags faststart -vcodec libx264 -b:v 1200K -filter:v fps=30 "${__dirname}\\preview.mp4"`
        );
        console.log("uploading preview...");
        const req1 = request.post(`http://${IP}:3000/api/${filename}/pupload`, () => {
            console.log("Done!");
        });
        const form1 = req1.form();
        console.log(JSON.stringify(DATA.Game));
        console.log(JSON.stringify(DATA.Combos));
        form1.append("Game", JSON.stringify(DATA.Game));
        form1.append("Combos", JSON.stringify(DATA.Combos));
        form1.append("vod", createReadStream(__dirname + "\\preview.mp4"));
    };

    if (DATA.isSkip) {
        request.post({
            url: `http://${IP}:3000/api/${filename}/reject`,
            form: { skipReason: DATA.skipReason }
        }, () => {
            console.log("skipped...");
        });
    } else {
        wrapUp();
    }
};

main();
