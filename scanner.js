const puppeteer = require('puppeteer');
const Table = require('cli-table');
const chalk = require('chalk');
const fs = require('fs');
const winston = require('winston');
const { combine, timestamp, printf } = winston.format;
const path = require('path');

// Define log format
const logFormat = printf(({ level, message, timestamp }) => {
  return `${timestamp} [${level.toUpperCase()}] ${message}`;
});

const createRequiredDirectories = async () => {
  try {
    await fs.promises.access('./data');
  } catch (error) {
    console.log(chalk.yellow('Creating data directory...'));
    await fs.promises.mkdir('./data');
  }

  try {
    await fs.promises.access('./logs');
  } catch (error) {
    console.log(chalk.yellow('Creating global logs directory...'));
    await fs.promises.mkdir('./logs');
  }
}

module.exports = initScan = async (data) => {

  await createRequiredDirectories();
  const {admin_url, is_bedrock, username, password } = data;
  const siteDomain = new URL(admin_url).hostname;
  const adminSlug = is_bedrock ? 'wp/wp-admin' : 'wp-admin';

  let plugins = [];

  try {
    await fs.promises.access(`./logs/${siteDomain}`);
  } catch (error) {
    console.log(chalk.yellow(`Creating logs directory for ${siteDomain}...`));
    await fs.promises.mkdir(`./logs/${siteDomain}`);
  }

  try {
    await fs.promises.access(`./data/${siteDomain}`);
  } catch (error) {
    console.log(chalk.yellow(`Creating data directory for ${siteDomain}...`));
    await fs.promises.mkdir(`./data/${siteDomain}`);
  }

  const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000); // 7 days in milliseconds
  const files = fs.readdirSync(`./data/${siteDomain}`);
  const existingFile = files.find(file => {
    const fileTimestamp = file.slice(0, 13);
    return fileTimestamp >= oneWeekAgo;
  });
  
  if (existingFile) {
    const data = fs.readFileSync(`./data/${siteDomain}/${existingFile}`);
    return JSON.parse(data);
  }

  const logFileName = `${Date.now()}.log`;
  const logFilePath = path.join(__dirname, `logs/${siteDomain}`, logFileName);

  // Create logger
  const logger = winston.createLogger({
    level: 'info',
    format: combine(timestamp(), logFormat),
    transports: [
      new winston.transports.File({ filename: logFilePath }),
    ],
  });

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  try {
    await loginToWordPressAdmin(page, admin_url, username, password, siteDomain, logger);
    await handleEmailVerification(page, logger);
    plugins = await getPluginsData(page, logger);
    // await displayPluginTable(plugins, logger);
    await savePluginDataToFile(plugins, siteDomain, logger);
  } catch (error) {
    logger.error(chalk.red(`Error processing ${siteDomain}: ${error}`));
  } finally {
    await browser.close();
    return plugins;
  }
};

const loginToWordPressAdmin = async (page, admin_url, username, password, siteDomain, logger) => {
  logger.info('Navigating to WordPress login...');
  await page.goto(admin_url);
  await page.waitForSelector('#user_login');
  await page.focus('#user_login');
  await page.evaluate((username) => { (document.getElementById('user_login')).value = username; }, username);
  await page.focus('#user_pass');
  await page.evaluate((password) => { (document.getElementById('user_pass')).value = password; }, password);
  logger.info(`Logging in to ${siteDomain}...`);
  await Promise.all([
    page.click('#wp-submit'),
    page.waitForNavigation()
  ]);

  if (await page.$('#login_error')) {
    throw new Error('Login unsuccessful.');
    logger.error('Login unsuccessful.');
  }
};

const handleEmailVerification = async (page, logger) => {
  const verifyEmailBtn = await page.$('form.admin-email-confirm-form .admin-email__actions-secondary > a');
  if (verifyEmailBtn) {
    logger.info('Email verification required. Clicking "remind me later" button...');
    await verifyEmailBtn.click();
    await page.waitForNavigation();
  }
};

const getPluginsData = async (page, logger) => {
  logger.info('Heading to plugins page...');
  await page.click(`#menu-plugins`);
  await page.waitForNavigation();

  logger.info('Parsing plugins...');
  const plugins = await page.$$('table.plugins tr');
  const pluginData = [];

  for (let i = 0; i < plugins.length; i++) {
    const plugin = plugins[i];
    const titleElement = await plugin.$('.plugin-title strong');

    if (titleElement) {
      const title = await (await titleElement.getProperty('innerText')).jsonValue();
      const versionElement = await plugin.$('.plugin-version-author-uri');

      if (versionElement) {
        const versionText = await (await versionElement.getProperty('innerText')).jsonValue();
        const version = getVersionNumber(versionText);
        const deactivateElement = await plugin.$('td.plugin-title span.deactivate');
        const activated = deactivateElement !== null;
        pluginData.push({ title, version, activated });
      }
    }
  }

  return pluginData;
};

// const displayPluginTable = async (plugins, logger) => {
//   const table = new Table({
//     head: ['Plugin', 'Version', 'Status'],
//   });

//   for (const plugin of plugins) {
//     const status = plugin.activated ? chalk.green('●') : chalk.red('●');
//     table.push([plugin.title, plugin.version, status]);
//   }
//   // console.log(table.toString());
// };

const savePluginDataToFile = async (pluginData,siteDomain,logger) => {
  const json = JSON.stringify(pluginData, null, 2);
  const fileName = `${Date.now()}.json`;
  await fs.promises.writeFile(`./data/${siteDomain}/${fileName}`, json);
  logger.info(`Plugin data saved to ${fileName}`);
};

const getVersionNumber = (versionText) => {
  const versionRegex = /(\d+)\.(\d+)(?:\.(\d+))?(?:-([a-zA-Z]+\d*))?/;
  const match = versionRegex.exec(versionText);
  return match ? match[0] : '';
}