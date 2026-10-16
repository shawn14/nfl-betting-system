import { NextResponse } from 'next/server';
import { loadTerminal } from '@/lib/terminal/data';
export const dynamic='force-dynamic';
export async function GET(){return NextResponse.json(await loadTerminal(),{headers:{'Cache-Control':'public, s-maxage=60'}});}
