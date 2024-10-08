import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { GoogleGenerativeAI } from '@google/generative-ai';
import chromium from '@sparticuz/chromium-min';
import { error } from '@sveltejs/kit';
import puppeteer from 'puppeteer-core';
import { get_roast, set_roast } from './db';

export const supported_langs = { id: 'Indonesia' }; // TODO: support more languages
export const default_lang = /** @type {[keyof supported_langs, string]} */ (
	Object.entries(supported_langs)[0]
);

const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });

/**
 * Generate roast text using Gemini
 *
 * @param {string} username
 * @param {keyof supported_langs} lang
 * @returns {Promise<string>}
 */
export async function roast_threads_user(username, lang) {
	username = username.toLocaleLowerCase();

	const cached = await get_roast(username, lang);
	if (cached?.result) return cached.result;

	const content = await get_threads_user_page(username);
	if (!content) throw new Error(`Failed to retrieve Threads user information`);

	if (/page isn't available/i.test(content)) {
		error(404, { message: 'Akun pengguna tidak ditemukan' });
	}

	if (/profile is private/i.test(content)) {
		error(403, { message: 'Tidak dapat melakukan roasting pada akun private' });
	}

	const prompt =
		`Kamu adalah seorang Comica yang mahir dalam StandUp Comedy dan kamu pandai melakukan roasting. ` +
		`Gunakan bahasa ${supported_langs[lang] || default_lang[1]}, berikan roasting singkat ` +
		`dengan kejam dan menyindir dalam bahasa gaul untuk profile Threads berikut: ${username}. ` +
		`Berikut detail dan beberapa thread-nya: ${content}. Ingat untuk tetap singkat dan padat dan ` +
		`juga hanya gunakan plain text tanpa format khusus penulisan`;

	const result = await model.generateContent(prompt);
	const text = result.response.text();
	await set_roast({ username, lang, result: text });
	return text;
}

/**
 * Scrap Threads user profile by username. Using scaping method for
 * now because Threads API required complicated steps
 *
 * @param {string} username
 * @returns {Promise<string | null>}
 */
export async function get_threads_user_page(username) {
	let browser;
	try {
		username = username.startsWith('@') ? username : '@' + username;
		browser = await puppeteer.launch({
			args: chromium.args,
			defaultViewport: chromium.defaultViewport,
			executablePath: dev
				? env.CHROMIUM_LOCAL_PATH
				: await chromium.executablePath(env.CHROMIUM_DOWNLOAD_URL)
		});
		const page = await browser.newPage();
		await page.goto(`https://www.threads.net/${username}`);
		await page.waitForNetworkIdle();
		const content = await page.evaluate(() => {
			const layout = document.querySelector(`div#barcelona-page-layout`);
			return layout?.textContent;
		});
		return (
			content
				?.slice(0, content?.indexOf('Log in to see more from'))
				?.replace('threads.net', ' ')
				?.replace(RegExp(username.slice(1), 'g'), ' ')
				?.replace(/Like\d*Comment\d*Repost\d*Share\d*/g, '')
				?.replace(/(?<!\s)More(?!\s)/g, ' ') || null
		);
	} finally {
		await browser?.close();
	}
}
