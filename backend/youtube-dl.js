const fs = require('fs-extra');
const fetch = require('node-fetch');
const path = require('path');
const execa = require('execa');
const kill = require('tree-kill');

const logger = require('./logger');
const utils = require('./utils');
const CONSTS = require('./consts');
const config_api = require('./config.js');

const is_windows = process.platform === 'win32';

exports.youtubedl_forks = {
    'youtube-dl': {
        'download_url': 'https://github.com/ytdl-org/youtube-dl/releases/latest/download/youtube-dl',
        'tags_url': 'https://api.github.com/repos/ytdl-org/youtube-dl/tags'
    },
    'youtube-dlc': {
        'download_url': 'https://github.com/blackjack4494/yt-dlc/releases/latest/download/youtube-dlc',
        'tags_url': 'https://api.github.com/repos/blackjack4494/yt-dlc/tags'
    },
    'yt-dlp': {
        'download_url': 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
        'tags_url': 'https://api.github.com/repos/yt-dlp/yt-dlp/tags'
    }
};

// Detect if the URL is a playlist (YouTube or YouTube Music)
function isPlaylist(url) {
    return url.includes("playlist?list=") || url.includes("&list=");
}

exports.runYoutubeDL = async (url, args = []) => {
    const output_file_path = getYoutubeDLPath();
    if (!fs.existsSync(output_file_path)) await exports.checkForYoutubeDLUpdate();

    // Adjust args based on whether it's a playlist
    if (isPlaylist(url)) {
        args.push("--yes-playlist"); // Ensure entire playlist downloads
    } else {
        args.push("--no-playlist"); // Only single video
    }

    return await runYoutubeDLProcess(url, args);
};

// Run youtube-dl in a subprocess (cancellable)
const runYoutubeDLProcess = async (url, args, youtubedl_fork = config_api.getConfigItem('ytdl_default_downloader')) => {
    const youtubedl_path = getYoutubeDLPath(youtubedl_fork);
    if (!fs.existsSync(youtubedl_path)) {
        const err = `Could not find ${youtubedl_fork} at ${youtubedl_path}`;
        logger.error(err);
        return;
    }
    
    const child_process = execa(youtubedl_path, [url, ...args], { maxBuffer: Infinity });
    
    const callback = new Promise(async resolve => {
        try {
            const { stdout, stderr } = await child_process;
            const parsed_output = utils.parseOutputJSON(stdout.trim().split(/\r?\n/), stderr);
            resolve({ parsed_output, err: stderr });
        } catch (e) {
            resolve({ parsed_output: null, err: e });
        }
    });

    return { child_process, callback };
};

function getYoutubeDLPath(youtubedl_fork = config_api.getConfigItem('ytdl_default_downloader')) {
    const binary_file_name = youtubedl_fork + (is_windows ? '.exe' : '');
    return path.join('appdata', 'bin', binary_file_name);
}

exports.killYoutubeDLProcess = async (child_process) => {
    kill(child_process.pid, 'SIGKILL');
};

exports.checkForYoutubeDLUpdate = async () => {
    const selected_fork = config_api.getConfigItem('ytdl_default_downloader');
    const output_file_path = getYoutubeDLPath();
    
    if (!fs.existsSync(CONSTS.DETAILS_BIN_PATH) || !fs.existsSync(output_file_path)) {
        logger.warn(`Updating ${selected_fork} binary...`);
        await exports.updateYoutubeDL();
    }
};

exports.updateYoutubeDL = async (latest_version = null) => {
    await fs.ensureDir(path.join('appdata', 'bin'));
    const default_downloader = config_api.getConfigItem('ytdl_default_downloader');
    await downloadLatestYoutubeDLBinaryGeneric(default_downloader, latest_version);
};

async function downloadLatestYoutubeDLBinaryGeneric(youtubedl_fork, new_version) {
    const file_ext = is_windows ? '.exe' : '';
    const download_url = `${exports.youtubedl_forks[youtubedl_fork]['download_url']}${file_ext}`;
    const output_path = getYoutubeDLPath(youtubedl_fork);

    try {
        await utils.fetchFile(download_url, output_path, `${youtubedl_fork} ${new_version}`);
        fs.chmod(output_path, 0o777);
        updateDetailsJSON(new_version, youtubedl_fork, output_path);
    } catch (e) {
        logger.error(`Failed to download new ${youtubedl_fork} version: ${new_version}`);
        logger.error(e);
    }
}

exports.getLatestUpdateVersion = async (youtubedl_fork) => {
    const tags_url = exports.youtubedl_forks[youtubedl_fork]['tags_url'];
    return new Promise(resolve => {
        fetch(tags_url)
            .then(res => res.json())
            .then(json => {
                if (!json || !json[0]) {
                    logger.error(`Failed to check ${youtubedl_fork} version.`);
                    resolve(null);
                    return;
                }
                resolve(json[0]['name']);
            })
            .catch(err => {
                logger.error(`Failed to check ${youtubedl_fork} version.`);
                logger.error(err);
                resolve(null);
            });
    });
};

function updateDetailsJSON(new_version, fork, output_path) {
    const file_ext = is_windows ? '.exe' : '';
    const details_json = fs.existsSync(CONSTS.DETAILS_BIN_PATH) ? fs.readJSONSync(CONSTS.DETAILS_BIN_PATH) : {};
    if (!details_json[fork]) details_json[fork] = {};
    details_json[fork] = { version: new_version, downloader: fork, path: output_path, exec: fork + file_ext };
    fs.writeJSONSync(CONSTS.DETAILS_BIN_PATH, details_json);
}
