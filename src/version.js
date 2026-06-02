let pkgVersion = 'unknown';
try {
  pkgVersion = require('../package.json').version || 'unknown';
} catch (e) {
}

const appVersion = process.env.APP_VERSION || pkgVersion;
const gitSha = process.env.APP_GIT_SHA || 'unknown';
const buildDate = process.env.APP_BUILD_DATE || 'unknown';
const nodeEnv = process.env.NODE_ENV || 'development';

const gitShaShort = gitSha === 'unknown' ? 'unknown' : gitSha.substring(0, 7);

module.exports = {
  appVersion,
  gitSha,
  gitShaShort,
  buildDate,
  nodeEnv,
};
