import { loadTerminal } from '@/lib/terminal/data';
import { readMeasurement } from '@/lib/measurement/read';
import Terminal from '@/components/terminal/Terminal';
import './terminal.css';
export const dynamic='force-dynamic';
export const metadata={title:'Research Terminal',description:'Forecasts, exact sportsbook prices and source evidence in one pregame workspace.'};
export default async function TerminalPage(){
 const [data,measurement]=await Promise.all([loadTerminal(),readMeasurement()]);
 return <Terminal initial={data} measurement={{state:measurement.state,captures:measurement.report?.captures??0,updated:measurement.report?.health?.updated??null}}/>;
}
