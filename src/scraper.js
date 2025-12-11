import dotenv from 'dotenv';
dotenv.config();
import { ScrapflyClient, ScrapeConfig } from 'scrapfly-sdk';
import * as cheerio from 'cheerio';

export class WebScraper {
  constructor() {
    const apiKey = process.env.SCRAPFLY_API_KEY;
    if (!apiKey) {
      throw new Error('SCRAPFLY_API_KEY is required. Please set it in your .env file.');
    }
    this.scrapfly = new ScrapflyClient({ key: apiKey });
  }

  async init() {
    // Scrapfly client is initialized in constructor, no need for separate init
    console.log('[Scraper] WebScraper initialized with Scrapfly SDK');
  }

  async close() {
    // Scrapfly handles connection management internally, no cleanup needed
    console.log('[Scraper] WebScraper closed');
  }
  // to get the school offical website from the niche page
  async scrapeNichePage(nicheUrl) {
    try {
      console.log(`[Scraper] Fetching school list from: ${nicheUrl}`);
      
      const result = await this.scrapfly.scrape(
        new ScrapeConfig({
          url: nicheUrl,
          asp: true, // Enable automatic anti-scraping protection bypass
          render_js: true, // Enable JavaScript rendering
          wait_for_selector: '.card.search-result', // Wait for school cards to load
        })
      );

      const content = result.result.content;
      const $ = cheerio.load(content);

      // Extract school links using the same approach as niche_scraper.js
      const schoolLinks = [];
      $('.card.search-result').each((i, el) => {
        const anchor = $(el).find('a.search-result__link').first();
        const profileUrl = anchor.attr('href')?.trim();
        
        if (profileUrl) {
          const fullUrl = profileUrl.startsWith('http') 
            ? profileUrl 
            : `https://www.niche.com${profileUrl}`;
          
          if (!schoolLinks.includes(fullUrl)) {
            schoolLinks.push(fullUrl);
          }
        }
      });

      console.log(`[Scraper] Found ${schoolLinks.length} school links`);
      return { content, schoolLinks };
    } catch (error) {
      console.error(`[Scraper] Error scraping niche page ${nicheUrl}:`, error);
      throw error;
    }
  }

  async scrapeNicheSchoolProfile(profileUrl) {
    try {
      console.log(`[Scraper] Fetching school profile: ${profileUrl}`);
  
      const result = await this.scrapfly.scrape(
        new ScrapeConfig({
          url: profileUrl,
          asp: true,
          render_js: true,
          wait_for_selector: 'h1.MuiTypography-root',
        })
      );
  
      const content = result.result.content;
      const $ = cheerio.load(content);
  
      // SCHOOL NAME
      const name = $('h1.MuiTypography-root').first().text().replace(/\s+/g, ' ').trim();
  
      // PHONE
      const phone = $('a.profile__telephone__link').text().trim();
  
      // ADDRESS BLOCK
      const rawAddress = $('address.profile__address--compact')
        .text()
        .replace(/\s+/g, ' ')
        .trim();
  
      // EXTRACT STATE (e.g. CT from "LAKEVILLE, CT 06039")
      let state = "";
      const stateMatch = rawAddress.match(/,\s*([A-Z]{2})\s*\d*/);
      if (stateMatch) {
        state = stateMatch[1];
      }
  
      // WEBSITE (existing logic preserved)
      const website = $('a.profile__website__link').attr('href')?.trim() || "";
  
      // Final structured object (DO NOT CHANGE KEYS)
      const schoolInfo = {
        name: name || "",
        address: rawAddress || "",
        state: state || "",
        phone: phone || "",
        website: website || ""
      };
      console.log("++++++++schoolInfo+++++++++", schoolInfo);
      return { schoolInfo };
  
    } catch (error) {
      console.error(`[Scraper] Error scraping school profile ${profileUrl}:`, error);
      return null;
    }
  }
  

  async scrapeContactPage(websiteUrl) {
    try {
      console.log(`[Scraper] Scraping school website: ${websiteUrl}`);
      
      // Scrape main page first
      const mainResult = await this.scrapfly.scrape(
        new ScrapeConfig({
          url: websiteUrl,
          asp: true, // Enable automatic anti-scraping protection bypass
          render_js: true, // Enable JavaScript rendering
        })
      );

      let allContent = mainResult.result.content;
      const $ = cheerio.load(allContent);

      // Try to find contact/faculty/staff page links
      const contactLinks = [];
      $('a').each((_, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().toLowerCase();
        const hrefLower = (href || '').toLowerCase();

        // Look for links related to contact, faculty, staff, directory, etc.
        if (/contact|about|staff|directory|faculty|team|administration|leadership|people/i.test(text) ||
            /contact|about|staff|directory|faculty|team|administration|leadership|people/i.test(hrefLower)) {
          let fullUrl = href;
          if (href && !href.startsWith('http')) {
            try {
              fullUrl = new URL(href, websiteUrl).href;
            } catch (e) {
              // Invalid URL, skip
              return;
            }
          }
          if (fullUrl && !contactLinks.includes(fullUrl) && contactLinks.length < 8) {
            contactLinks.push(fullUrl);
          }
        }
      });

      // Remove duplicates
      const uniqueLinks = [...new Set(contactLinks)];
      console.log(`[Scraper] Found ${uniqueLinks.length} potential contact/faculty pages`);

      // Scrape each potential contact page
      for (const link of uniqueLinks) {
        try {
          const contactResult = await this.scrapfly.scrape(
            new ScrapeConfig({
              url: link,
              asp: true, // Enable automatic anti-scraping protection bypass
              render_js: true, // Enable JavaScript rendering
            })
          );
          allContent += '\n---PAGE_SEPARATOR---\n' + contactResult.result.content;
          console.log(`[Scraper] Scraped: ${link}`);
        } catch (e) {
          console.log(`[Scraper] Failed to scrape contact page: ${link}`);
        }
      }

      return allContent;
    } catch (error) {
      console.error(`[Scraper] Error scraping contact page ${websiteUrl}:`, error);
      throw error;
    }
  }
}
