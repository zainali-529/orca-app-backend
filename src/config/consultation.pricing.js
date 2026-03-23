/**
 * Consultation Pricing — PAID ONLY
 *
 * Server-side only. Client NEVER sends a price.
 * Prices in £ (pounds). pricePence auto-calculated.
 *
 * To change prices: update here. Changes take effect immediately.
 */

const PRICING = {
  general: [
    { duration: 30, price: 29, label: 'Quick Energy Review (30 min)'  },
    { duration: 45, price: 49, label: 'Energy Review (45 min)'        },
    { duration: 60, price: 69, label: 'Full Energy Review (60 min)'   },
  ],
  tariff_review: [
    { duration: 45, price: 49, label: 'Tariff Review (45 min)'          },
    { duration: 60, price: 69, label: 'Detailed Tariff Review (60 min)' },
  ],
  switch_advice: [
    { duration: 30, price: 29, label: 'Switch Advice (30 min)'    },
    { duration: 45, price: 49, label: 'Switch Planning (45 min)'  },
  ],
  contract_review: [
    { duration: 45, price: 59, label: 'Contract Review (45 min)'       },
    { duration: 60, price: 79, label: 'Full Contract Review (60 min)'  },
  ],
  energy_audit: [
    { duration: 60, price: 99, label: 'Energy Audit (60 min)' },
  ],
  renewal_advice: [
    { duration: 30, price: 29, label: 'Renewal Advice (30 min)'    },
    { duration: 45, price: 49, label: 'Renewal Planning (45 min)'  },
  ],
  new_connection: [
    { duration: 45, price: 49, label: 'New Connection Advice (45 min)'   },
    { duration: 60, price: 69, label: 'New Connection Planning (60 min)' },
  ],
};

/**
 * Look up price — server always uses this, never trusts client price.
 * Returns null if invalid combination.
 */
const lookupPrice = (category, duration) => {
  const options = PRICING[category];
  if (!options) return null;
  const match = options.find((o) => o.duration === duration);
  if (!match) return null;
  return {
    price:      match.price,
    pricePence: Math.round(match.price * 100),
    label:      match.label,
  };
};

/**
 * Get all options for the client /options endpoint.
 * Returns flat array grouped by category.
 */
const getAvailableOptions = () => {
  const categories = {
    general:         { icon: '💡', title: 'General Energy Advice',       description: 'General review of your energy situation and options.' },
    tariff_review:   { icon: '📊', title: 'Tariff Review',               description: 'In-depth analysis of your current tariffs vs market.' },
    switch_advice:   { icon: '🔄', title: 'Switching Advice',            description: 'Expert guidance on switching suppliers safely.' },
    contract_review: { icon: '📋', title: 'Contract Review',             description: 'Review your existing energy contracts before renewal.' },
    energy_audit:    { icon: '🔍', title: 'Full Energy Audit',           description: 'Complete audit of your energy usage and costs.' },
    renewal_advice:  { icon: '📅', title: 'Renewal Advice',              description: 'Advice for upcoming contract renewals.' },
    new_connection:  { icon: '🏢', title: 'New Connection / New Premises', description: 'Setting up energy for a new property or business.' },
  };

  return Object.entries(PRICING).map(([category, options]) => ({
    category,
    ...categories[category],
    options: options.map((o) => ({
      duration:   o.duration,
      price:      o.price,
      pricePence: Math.round(o.price * 100),
      label:      o.label,
    })),
    minPrice: Math.min(...options.map((o) => o.price)),
    maxPrice: Math.max(...options.map((o) => o.price)),
  }));
};

module.exports = { lookupPrice, getAvailableOptions };