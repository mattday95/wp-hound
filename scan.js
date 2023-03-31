const puppeteer = require('puppeteer');
const Table = require('cli-table');
const chalk = require('chalk');
const fs = require('fs').promises;

(async () => {
  const siteData = await fs.readFile('./sites.json');
  const sites = JSON.parse(siteData);

  for (const { admin_url, is_bedrock, username, password } of sites) {
    const siteDomain = new URL(admin_url).hostname;
    const adminSlug = is_bedrock ? 'wp/wp-admin' : 'wp-admin';

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    try {
      await loginToWordPressAdmin(page, admin_url, username, password, siteDomain);
      await handleEmailVerification(page);
      const plugins = await getPluginsData(page);
      await displayPluginTable(plugins);
      await savePluginDataToFile(plugins, siteDomain);
    } catch (error) {
      console.error(chalk.red(`Error processing ${siteDomain}: ${error}`));
    } finally {
      await browser.close();
    }
  }
})();

const loginToWordPressAdmin = async (page, admin_url, username, password, siteDomain) => {
  console.log(chalk.green('Navigating to WordPress login...'));
  await page.goto(admin_url);
  await page.waitForSelector('#user_login');
  await page.focus('#user_login');
  await page.evaluate((username) => { (document.getElementById('user_login')).value = username; }, username);
  await page.focus('#user_pass');
  await page.evaluate((password) => { (document.getElementById('user_pass')).value = password; }, password);
  console.log(chalk.green(`Logging in to ${siteDomain}...`));
  await Promise.all([
    page.click('#wp-submit'),
    page.waitForNavigation()
  ]);

  if (await page.$('#login_error')) {
    throw new Error('Login unsuccessful.');
  }
};

const handleEmailVerification = async (page) => {
  const verifyEmailBtn = await page.$('form.admin-email-confirm-form .admin-email__actions-secondary > a');
  if (verifyEmailBtn) {
    console.log(chalk.green('Email verification required. Clicking "remind me later" button...'));
    await verifyEmailBtn.click();
    await page.waitForNavigation();
  }
};

const getPluginsData = async (page) => {
  console.log(chalk.green('Heading to plugins page...'));
  await page.click(`#menu-plugins`);
  await page.waitForNavigation();

  console.log(chalk.green('Parsing plugins...'));
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

const displayPluginTable = async (plugins) => {
  const table = new Table({
    head: ['Plugin', 'Version', 'Status'],
  });

  for (const plugin of plugins) {
    const status = plugin.activated ? chalk.green('●') : chalk.red('●');
    table.push([plugin.title, plugin.version, status]);
  }

  console.log(table.toString());
};

const savePluginDataToFile = async (pluginData,siteDomain) => {
  const json = JSON.stringify(pluginData, null, 2);
  const fileName = `${siteDomain}.json`;
  await fs.writeFile(`./data/${fileName}`, json);
  console.log(`Plugin data saved to ${fileName}`);
};

const getVersionNumber = (versionText) => {
  const versionRegex = /(\d+)\.(\d+)(?:\.(\d+))?(?:-([a-zA-Z]+\d*))?/;
  const match = versionRegex.exec(versionText);
  return match ? match[0] : '';
}