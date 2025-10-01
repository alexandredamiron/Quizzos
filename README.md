# Quizzos

A multiplayer image quiz game built with Next.js, TypeScript, Tailwind CSS, and Ably for real-time sync.

## Features

- 2x2 grid of flippable image cards
- Real-time multiplayer sync using Ably
- Modern gradient design with purple/pink theme
- Responsive input controls
- Ready for Vercel deployment

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create `.env.local` file with your Ably API key:
```bash
cp .env.local.example .env.local
```

3. Get your Ably API key from [ably.com](https://ably.com) and add it to `.env.local`:
```
NEXT_PUBLIC_ABLY_API_KEY=your-actual-api-key
```

4. Run the development server:
```bash
npm run dev
```

5. Open [http://localhost:3000](http://localhost:3000)

## Deploy to Vercel

1. Push your code to GitHub
2. Import your repository in Vercel
3. Add the `NEXT_PUBLIC_ABLY_API_KEY` environment variable
4. Deploy!

## Usage

- Click cards to flip them individually
- Click "Display" to reveal all cards
- Use the input fields to enter data (synced across all players)
- "Compute Similarity" button ready for your custom implementation
