const XLSX = require('xlsx');
const path = require('path');

const desktopPath = path.join('C:', 'Users', 'Work', 'Desktop', 'foia_us_cases.xlsx');

const cases = [
  { title: "Request for Bodycam Footage — George Floyd Protest, Minneapolis PD", description: "Demand for all body-worn camera footage from Minneapolis Police Department regarding the May 2020 protests, including all on-scene officers' recordings.", priority: "high", client_name: "ACLU Minnesota", agencies: "1,22,23" },
  { title: "FBI Records on Domestic Extremism Investigations — January 6, 2021", description: "FOIA request for all FBI records, reports, and communications related to the investigation of domestic extremist groups involved in the January 6 Capitol breach.", priority: "high", client_name: "ProPublica", agencies: "1,2,9" },
  { title: "NYPD Stop-and-Frisk Data — 2020-2024", description: "Request for complete NYPD stop-and-frisk records including race, location, and outcome data for the period January 2020 to present.", priority: "medium", client_name: "NYCLU", agencies: "21" },
  { title: "LAPD Use of Force Reports — 2023", description: "FOIA request seeking all LAPD use of force incident reports, internal investigations, and disciplinary outcomes for the calendar year 2023.", priority: "high", client_name: "Los Angeles Times", agencies: "22" },
  { title: "ICE Detention Center Inspection Reports — 2024", description: "Request for all ICE Office of Detention Oversight inspection reports for privately-run detention facilities in Texas, California, and Florida.", priority: "medium", client_name: "Texas Tribune", agencies: "6" },
  { title: "ATF Trace Data — Ghost Guns Recovered 2022-2024", description: "FOIA request for Bureau of Alcohol, Tobacco, Firearms and Explosives trace data on privately manufactured firearms (ghost guns) recovered by law enforcement.", priority: "high", client_name: "The Trace", agencies: "3" },
  { title: "Chicago PD Body Camera Audit Reports — 2022-2023", description: "Request for Chicago Police Department body-worn camera audit reports, including compliance rates, footage retention, and BWC policy violation records.", priority: "medium", client_name: "Invisible Institute", agencies: "23" },
  { title: "TSA Screening Footage — Airport Security Incidents", description: "FOIA request for Transportation Security Administration screening footage and incident reports related to racial profiling complaints at major US airports.", priority: "low", client_name: "Equal Justice Initiative", agencies: "7" },
  { title: "DOJ Civil Rights Division — Pattern or Practice Investigations", description: "Request for all U.S. Department of Justice Civil Rights Division pattern or practice investigation reports opened since 2020, including consent decrees.", priority: "high", client_name: "The Marshall Project", agencies: "9" },
  { title: "BOP Prison Surveillance Footage — Solitary Confinement Units", description: "FOIA request for Bureau of Prisons surveillance video footage and logs from solitary confinement units at ADX Florence and USP Lewisburg.", priority: "medium", client_name: "Solitary Watch", agencies: "10" },
  { title: "DEA Wiretap Applications — Federal Courts 2023", description: "Request for Drug Enforcement Administration wiretap application summaries approved by federal courts in 2023, excluding ongoing investigations.", priority: "low", client_name: "Electronic Frontier Foundation", agencies: "2" },
  { title: "US Marshals Witness Security Program Records", description: "FOIA request for U.S. Marshals Service records on the Witness Security Program — policies, budget, and number of active participants since 2020.", priority: "medium", client_name: "The Intercept", agencies: "4" },
  { title: "Texas DPS Bodycam — Uvalde School Shooting Response", description: "Urgent request for Texas Department of Public Safety body-worn camera footage and incident command logs related to the Robb Elementary School shooting response.", priority: "high", client_name: "Austin American-Statesman", agencies: "12" },
  { title: "Florida Highway Patrol — Traffic Stop Racial Data", description: "FOIA request for Florida Highway Patrol traffic stop data including race, search rates, and contraband hit rates for 2022-2024.", priority: "medium", client_name: "Florida Center for Investigative Reporting", agencies: "14" },
  { title: "California Highway Patrol — Use of Force by Officer Demographics", description: "Request for California Highway Patrol use of force data broken down by officer race, age, years of service, and geographic region.", priority: "medium", client_name: "Capital Public Radio", agencies: "11" },
  { title: "Arizona DPS — Immigration Checkpoint Camera Footage", description: "FOIA request for Arizona Department of Public Safety camera footage from immigration checkpoints on Interstate 19, including BWC of checkpoint encounters.", priority: "low", client_name: "ACLU Arizona", agencies: "16" },
  { title: "CBP Use of Force Incidents — Southern Border 2023", description: "Request for Customs and Border Protection use of force incident reports, including video evidence and internal review outcomes for the Southern border sector.", priority: "high", client_name: "KPBS / NPR", agencies: "5" },
  { title: "NY State Police — Surveillance Drone Program Records", description: "FOIA request for New York State Police drone surveillance program records including flights logged, data retention policies, and civilian privacy complaints.", priority: "low", client_name: "Privacy International", agencies: "13" },
];

// Create workbook
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.json_to_sheet(cases);
XLSX.utils.book_append_sheet(wb, ws, 'Cases');
XLSX.writeFile(wb, desktopPath);

console.log('✅ Excel written to:', desktopPath);
console.log('📊 Cases:', cases.length);
