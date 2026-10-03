const axios = require('axios');
const Product = require('../models/Product');
const logger = require('../utils/logger');

class KeywordEnhancementService {
  constructor() {
    this.aiServiceUrl = process.env.AI_SERVICE_URL || 'http://localhost:8000';
    this.openaiApiKey = process.env.OPENAI_API_KEY;
  }

  /**
   * Enhance keywords for a product
   */
  async enhanceKeywords(productId, options = {}) {
    const product = await Product.findById(productId);
    if (!product) throw new Error('Product not found');

    logger.info(`Enhancing keywords for product: ${product.sku}`);

    try {
      // Generate AI-enhanced keywords
      const aiKeywords = await this.generateAIKeywords(
        product.name,
        product.description,
        product.category
      );

      // Research keywords using external API
      const researchedKeywords = await this.researchKeywords(
        product.name,
        product.category
      );

      // Combine and deduplicate
      const allKeywords = this.combineAndDeduplicate(
        product.seo.secondaryKeywords || [],
        aiKeywords,
        researchedKeywords
      );

      // Score keywords by relevance
      const scoredKeywords = await this.scoreKeywords(allKeywords, product);

      // Generate marketplace-specific keywords
      const marketplaceKeywords = {
        amazon: this.optimizeForAmazon(scoredKeywords, product),
        flipkart: this.optimizeForFlipkart(scoredKeywords, product),
        meesho: this.optimizeForMeesho(scoredKeywords, product)
      };

      // Update product SEO
      product.seo.enhancedKeywords = scoredKeywords
        .slice(0, 20)
        .map(k => k.keyword);
      product.seo.secondaryKeywords = marketplaceKeywords.amazon;
      product.seo.keywordScore = this.calculateOverallScore(scoredKeywords);

      // Generate long-tail keywords
      product.seo.metaDescription = this.generateMetaDescription(
        product.name,
        scoredKeywords
      );

      await product.save();

      return {
        success: true,
        enhancedKeywords: product.seo.enhancedKeywords,
        keywordScore: product.seo.keywordScore,
        marketplaceKeywords,
        scoredKeywords: scoredKeywords.slice(0, 50),
        longTailKeywords: this.generateLongTailKeywords(scoredKeywords, product)
      };

    } catch (error) {
      logger.error(`Keyword enhancement failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generate keywords using AI (OpenAI or similar)
   */
  async generateAIKeywords(productName, description, category) {
    try {
      const response = await axios.post(
        `${this.aiServiceUrl}/api/keywords/generate`,
        {
          productName,
          description,
          category
        },
        { timeout: 30000 }
      );

      return response.data.keywords || [];
    } catch (error) {
      logger.error(`AI keyword generation failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Research keywords using external services
   */
  async researchKeywords(productName, category) {
    try {
      // Using a free/API-based keyword research tool
      const keywords = [];

      // Search volume data could come from Google Trends, SEMrush API, etc.
      // For now, we'll use local enrichment
      const variations = [
        `${productName} online`,
        `buy ${productName}`,
        `${productName} price`,
        `${productName} amazon`,
        `${category} ${productName}`,
        `best ${category}`,
        `${productName} features`,
        `${productName} specifications`,
        `${productName} vs`,
        `${productName} reviews`
      ];

      return variations.map(kw => ({
        keyword: kw,
        searchVolume: Math.floor(Math.random() * 10000), // Mock data
        competition: this.estimateCompetition(kw)
      }));

    } catch (error) {
      logger.error(`Keyword research failed: ${error.message}`);
      return [];
    }
  }

  /**
   * Score keywords by relevance
   */
  async scoreKeywords(keywords, product) {
    const scored = keywords.map(keyword => {
      let score = 50; // Base score

      // Boost score if keyword appears in product data
      if (product.name.toLowerCase().includes(keyword.keyword.toLowerCase())) score += 30;
      if (product.description.toLowerCase().includes(keyword.keyword.toLowerCase())) score += 20;
      if (product.category.toLowerCase().includes(keyword.keyword.toLowerCase())) score += 15;

      // Factor in search volume and competition
      if (keyword.searchVolume) {
        score += Math.min(keyword.searchVolume / 1000, 20);
      }

      if (keyword.competition === 'low') score += 15;
      else if (keyword.competition === 'medium') score += 10;
      // high competition doesn't add bonus

      return {
        ...keyword,
        relevanceScore: Math.min(score, 100),
        length: keyword.keyword.split(' ').length
      };
    });

    return scored.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  /**
   * Optimize keywords for Amazon
   */
  optimizeForAmazon(keywords, product) {
    // Amazon prefers:
    // - 7-10 word phrases
    // - High search volume
    // - Product features
    return keywords
      .filter(k => k.length >= 2 && k.length <= 5)
      .filter(k => k.relevanceScore >= 60)
      .slice(0, 10)
      .map(k => k.keyword);
  }

  /**
   * Optimize keywords for Flipkart
   */
  optimizeForFlipkart(keywords, product) {
    // Flipkart prefers:
    // - Brand + product type
    // - Feature-based keywords
    // - Price-related terms
    return keywords
      .filter(k => k.relevanceScore >= 50)
      .slice(0, 8)
      .map(k => k.keyword);
  }

  /**
   * Optimize keywords for Meesho
   */
  optimizeForMeesho(keywords, product) {
    // Meesho prefers:
    // - Long-tail keywords
    // - Reseller-friendly terms
    // - High-volume, lower-competition keywords
    return keywords
      .filter(k => k.length >= 2)
      .filter(k => k.competition === 'low' || k.competition === 'medium')
      .slice(0, 15)
      .map(k => k.keyword);
  }

  /**
   * Generate long-tail keyword variations
   */
  generateLongTailKeywords(keywords, product) {
    const longTail = [];
    const baseKeywords = keywords.slice(0, 5).map(k => k.keyword);

    for (const keyword of baseKeywords) {
      longTail.push(`${keyword} in india`);
      longTail.push(`${keyword} online`);
      longTail.push(`${keyword} price`);
      longTail.push(`buy ${keyword}`);
      longTail.push(`${keyword} best`);
      longTail.push(`${keyword} deal`);
      longTail.push(`${keyword} amazon`);
      longTail.push(`${keyword} flipkart`);
    }

    return [...new Set(longTail)];
  }

  /**
   * Generate meta description from keywords
   */
  generateMetaDescription(productName, keywords) {
    const topKeyword = keywords[0]?.keyword || productName;
    return `Buy ${productName} online. Best ${topKeyword} with great features and affordable price. Shop now on Amazon, Flipkart, Meesho.`;
  }

  /**
   * Calculate overall keyword score
   */
  calculateOverallScore(keywords) {
    if (keywords.length === 0) return 0;
    const sum = keywords.reduce((acc, k) => acc + k.relevanceScore, 0);
    return Math.round(sum / keywords.length);
  }

  /**
   * Combine and deduplicate keywords
   */
  combineAndDeduplicate(original, aiKeywords, researched) {
    const combined = [
      ...original,
      ...aiKeywords.map(k => k.keyword || k),
      ...researched.map(k => k.keyword || k)
    ];

    const keywordMap = new Map();
    for (const kw of combined) {
      const normalized = kw.toLowerCase().trim();
      if (!keywordMap.has(normalized)) {
        keywordMap.set(normalized, kw);
      }
    }

    return Array.from(keywordMap.values()).map(kw => ({
      keyword: kw,
      searchVolume: 0,
      competition: 'medium'
    }));
  }

  /**
   * Estimate competition level
   */
  estimateCompetition(keyword) {
    // Mock implementation - would use real API data
    const wordCount = keyword.split(' ').length;
    if (wordCount >= 3) return 'low';
    if (wordCount === 2) return 'medium';
    return 'high';
  }

  /**
   * Batch enhance keywords for multiple products
   */
  async batchEnhanceKeywords(productIds, options = {}) {
    const results = [];

    for (const productId of productIds) {
      try {
        const result = await this.enhanceKeywords(productId, options);
        results.push({ productId, success: true, ...result });
      } catch (error) {
        results.push({ productId, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * Get keyword suggestions based on competitor analysis
   */
  async getCompetitorKeywords(productId, competitorCount = 5) {
    const product = await Product.findById(productId);
    if (!product) throw new Error('Product not found');

    // Would integrate with competitor analysis tools
    // For now, returning mock data
    return {
      productSku: product.sku,
      yourKeywords: product.seo.enhancedKeywords || [],
      competitorKeywords: {
        amazon: ['competitor keyword 1', 'competitor keyword 2'],
        flipkart: ['competitor keyword 3', 'competitor keyword 4'],
        meesho: ['competitor keyword 5', 'competitor keyword 6']
      },
      missingKeywords: ['high opportunity keyword 1', 'high opportunity keyword 2']
    };
  }
}

module.exports = new KeywordEnhancementService();
