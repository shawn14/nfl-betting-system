import { NextResponse } from 'next/server';
import { readMeasurement } from '@/lib/measurement/read';
export const dynamic='force-dynamic';
export async function GET() {
  const result=await readMeasurement(true);
  return NextResponse.json(result,{status:result.state==='unavailable'?503:200,headers:{'Cache-Control':'public, s-maxage=300'}});
}
