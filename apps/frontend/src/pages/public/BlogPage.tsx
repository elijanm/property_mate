import { useState } from 'react'
import PublicShell from '@/layouts/PublicShell'

const BLUE = '#1D4ED8'

interface Post {
  slug: string
  category: string
  title: string
  excerpt: string
  author: string
  date: string
  readTime: string
  featured?: boolean
}

const POSTS: Post[] = [
  {
    slug: 'mpesa-rent-collection-guide',
    category: 'Collections',
    title: 'The complete guide to Mpesa rent collection in Kenya (2025)',
    excerpt: 'Everything landlords need to know about setting up C2B paybill, reconciling payments, and handling disputes — with or without property management software.',
    author: 'Samuel Odhiambo',
    date: '14 Apr 2025',
    readTime: '8 min read',
    featured: true,
  },
  {
    slug: 'digital-lease-east-africa',
    category: 'Leases',
    title: 'Are digital leases legally binding in Kenya, Uganda, and Tanzania?',
    excerpt: 'A plain-language breakdown of e-signature law across East Africa and what landlords need to do to make digital leases enforceable.',
    author: 'Wanjiru Njue',
    date: '7 Apr 2025',
    readTime: '6 min read',
    featured: true,
  },
  {
    slug: 'arrears-management',
    category: 'Collections',
    title: 'How to reduce rent arrears without losing good tenants',
    excerpt: 'The tactics that consistently work — automated reminders, flexible payment schedules, and using data to identify at-risk tenants before they fall behind.',
    author: 'Amara Osei',
    date: '31 Mar 2025',
    readTime: '5 min read',
  },
  {
    slug: 'utility-billing-tiered',
    category: 'Utilities',
    title: 'Tiered water billing in Kenya: how to set it up correctly',
    excerpt: 'County water tariffs use tiered pricing. Here\'s how to apply them accurately per unit and generate invoices tenants can actually understand.',
    author: 'David Kimani',
    date: '24 Mar 2025',
    readTime: '7 min read',
  },
  {
    slug: 'property-manager-vs-landlord',
    category: 'Management',
    title: 'When to hire a property manager (and when not to)',
    excerpt: 'The decision depends on your unit count, your time, and whether you live near your properties. A framework for making the right call.',
    author: 'Amara Osei',
    date: '17 Mar 2025',
    readTime: '4 min read',
  },
  {
    slug: 'iot-meter-reading',
    category: 'Technology',
    title: 'IoT water meters in rental properties: are they worth it?',
    excerpt: 'We looked at the data from 600+ units that switched from manual meter reading to IoT. The results on billing accuracy and tenant disputes were clear.',
    author: 'David Kimani',
    date: '10 Mar 2025',
    readTime: '6 min read',
  },
  {
    slug: 'maintenance-vendor-management',
    category: 'Maintenance',
    title: 'Building a reliable vendor network for your properties',
    excerpt: 'How to vet, onboard, and manage service providers — plumbers, electricians, and general contractors — so maintenance doesn\'t become your full-time job.',
    author: 'Samuel Odhiambo',
    date: '3 Mar 2025',
    readTime: '5 min read',
  },
  {
    slug: 'rental-yield-analysis',
    category: 'Finance',
    title: 'Calculating real rental yield in Nairobi: what landlords get wrong',
    excerpt: 'Gross yield is easy to compute. Net yield after service charges, vacancies, and maintenance is what actually matters. Here\'s the right way to model it.',
    author: 'Wanjiru Njue',
    date: '24 Feb 2025',
    readTime: '7 min read',
  },
]

const CATEGORIES = ['All', 'Collections', 'Leases', 'Utilities', 'Maintenance', 'Finance', 'Technology', 'Management']

const CATEGORY_COLORS: Record<string, string> = {
  Collections: 'bg-blue-50 text-blue-700',
  Leases:      'bg-violet-50 text-violet-700',
  Utilities:   'bg-cyan-50 text-cyan-700',
  Maintenance: 'bg-amber-50 text-amber-700',
  Finance:     'bg-green-50 text-green-700',
  Technology:  'bg-indigo-50 text-indigo-700',
  Management:  'bg-gray-100 text-gray-700',
}

function PostCard({ post, large = false }: { post: Post; large?: boolean }) {
  return (
    <article
      className={`rounded-lg border border-gray-200 bg-white p-5 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer ${large ? 'sm:p-7' : ''}`}
      onClick={() => {/* future: navigate to post */}}
    >
      <div className="flex items-center gap-2 mb-3">
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${CATEGORY_COLORS[post.category] ?? 'bg-gray-100 text-gray-600'}`}>
          {post.category}
        </span>
        <span className="text-[11px] text-gray-400">{post.readTime}</span>
      </div>
      <h2 className={`font-bold text-gray-900 leading-snug mb-2 ${large ? 'text-xl' : 'text-[15px]'}`}>
        {post.title}
      </h2>
      <p className={`text-gray-500 leading-relaxed ${large ? 'text-sm' : 'text-[13px]'}`}>{post.excerpt}</p>
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
               style={{ backgroundColor: BLUE }}>
            {post.author.split(' ').map(n => n[0]).join('')}
          </div>
          <span className="text-[12px] text-gray-500">{post.author}</span>
        </div>
        <span className="text-[11px] text-gray-400">{post.date}</span>
      </div>
    </article>
  )
}

export default function BlogPage() {
  const [activeCategory, setActiveCategory] = useState('All')

  const filtered = activeCategory === 'All'
    ? POSTS
    : POSTS.filter(p => p.category === activeCategory)

  const featured = filtered.filter(p => p.featured)
  const rest = filtered.filter(p => !p.featured)

  return (
    <PublicShell>
      {/* Header */}
      <div className="border-b border-gray-100 bg-gray-50 py-10">
        <div className="mx-auto max-w-6xl px-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-blue-600 mb-1">Blog</p>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 sm:text-3xl">Property management insights</h1>
              <p className="mt-1 text-sm text-gray-500">Guides, how-tos, and analysis for East African landlords and property managers.</p>
            </div>
            <a href="mailto:hello@faharicloud.com?subject=Blog contribution"
               className="text-sm font-semibold text-blue-600 hover:text-blue-700 shrink-0">
              Write for us →
            </a>
          </div>
        </div>
      </div>

      {/* Category filter */}
      <div className="border-b border-gray-100 bg-white">
        <div className="mx-auto max-w-6xl px-5">
          <div className="flex items-center gap-1 overflow-x-auto py-3 scrollbar-hide">
            {CATEGORIES.map(cat => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                  activeCategory === cat
                    ? 'text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
                style={activeCategory === cat ? { backgroundColor: BLUE } : {}}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Posts */}
      <div className="py-10">
        <div className="mx-auto max-w-6xl px-5">
          {/* Featured */}
          {featured.length > 0 && (
            <div className="mb-6">
              <div className="grid gap-5 sm:grid-cols-2">
                {featured.map(post => <PostCard key={post.slug} post={post} large />)}
              </div>
            </div>
          )}

          {/* Rest */}
          {rest.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rest.map(post => <PostCard key={post.slug} post={post} />)}
            </div>
          )}

          {filtered.length === 0 && (
            <div className="py-20 text-center">
              <p className="text-gray-500 text-sm">No posts in this category yet.</p>
            </div>
          )}
        </div>
      </div>

      {/* Newsletter */}
      <div className="border-t border-gray-100 bg-gray-50 py-10">
        <div className="mx-auto max-w-xl px-5 text-center">
          <h3 className="text-base font-bold text-gray-900">Get new posts in your inbox</h3>
          <p className="mt-1.5 text-sm text-gray-500">
            No spam. One email when we publish something worth reading.
          </p>
          <form className="mt-4 flex gap-2" onSubmit={e => e.preventDefault()}>
            <input
              type="email"
              placeholder="you@company.com"
              className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              className="rounded-md px-4 py-2 text-sm font-semibold text-white hover:opacity-90 transition"
              style={{ backgroundColor: BLUE }}
            >
              Subscribe
            </button>
          </form>
          <p className="mt-2 text-[11px] text-gray-400">Unsubscribe at any time.</p>
        </div>
      </div>
    </PublicShell>
  )
}
