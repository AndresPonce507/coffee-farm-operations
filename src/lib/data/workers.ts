import type { Worker } from "@/lib/types";

/**
 * Canonical workforce for Janson Coffee. Referential ANCHOR file —
 * harvests reference picker names, tasks reference assignees, payroll rolls up here.
 */
export const CREWS = ["Crew Norte", "Crew Tizingal", "Crew Mill", "Field Ops"] as const;

export const workers: Worker[] = [
  { id: "w-01", name: "Miguel Janson", role: "Supervisor", dailyRateUsd: 42, attendance: "present", startedYear: 2009, phone: "+507 6500-1209", todayKg: 0, crew: "Field Ops" },
  { id: "w-02", name: "Janette Janson", role: "Agronomist", dailyRateUsd: 48, attendance: "present", startedYear: 2011, phone: "+507 6500-3382", todayKg: 0, crew: "Field Ops" },
  { id: "w-03", name: "Eduardo Pérez", role: "Picker", dailyRateUsd: 22, attendance: "present", startedYear: 2015, phone: "+507 6612-7741", todayKg: 92, crew: "Crew Norte" },
  { id: "w-04", name: "Rosa Quintero", role: "Picker", dailyRateUsd: 22, attendance: "present", startedYear: 2016, phone: "+507 6633-1180", todayKg: 84, crew: "Crew Norte" },
  { id: "w-05", name: "Tomás Atencio", role: "Picker", dailyRateUsd: 22, attendance: "present", startedYear: 2018, phone: "+507 6644-9921", todayKg: 64, crew: "Crew Tizingal" },
  { id: "w-06", name: "Lucía Morales", role: "Picker", dailyRateUsd: 22, attendance: "present", startedYear: 2019, phone: "+507 6655-2210", todayKg: 88, crew: "Crew Tizingal" },
  { id: "w-07", name: "Carlos Beker", role: "Picker", dailyRateUsd: 22, attendance: "rest-day", startedYear: 2014, phone: "+507 6677-4456", todayKg: 0, crew: "Crew Norte" },
  { id: "w-08", name: "Ana Serrano", role: "Picker", dailyRateUsd: 22, attendance: "present", startedYear: 2020, phone: "+507 6688-0034", todayKg: 76, crew: "Crew Tizingal" },
  { id: "w-09", name: "Pedro Caballero", role: "Picker", dailyRateUsd: 22, attendance: "present", startedYear: 2017, phone: "+507 6699-7712", todayKg: 90, crew: "Crew Norte" },
  { id: "w-10", name: "Néstor Gómez", role: "Mill Operator", dailyRateUsd: 30, attendance: "present", startedYear: 2013, phone: "+507 6701-5589", todayKg: 0, crew: "Crew Mill" },
  { id: "w-11", name: "Yarisel Pitti", role: "Mill Operator", dailyRateUsd: 30, attendance: "present", startedYear: 2018, phone: "+507 6712-3301", todayKg: 0, crew: "Crew Mill" },
  { id: "w-12", name: "Raúl Santamaría", role: "Driver", dailyRateUsd: 28, attendance: "present", startedYear: 2012, phone: "+507 6723-8890", todayKg: 0, crew: "Field Ops" },
  { id: "w-13", name: "Iris Castillo", role: "Picker", dailyRateUsd: 22, attendance: "present", startedYear: 2021, phone: "+507 6734-1145", todayKg: 71, crew: "Crew Tizingal" },
  { id: "w-14", name: "Félix Rodríguez", role: "Picker", dailyRateUsd: 22, attendance: "present", startedYear: 2016, phone: "+507 6745-6622", todayKg: 79, crew: "Crew Norte" },
];

export const pickers = workers.filter((w) => w.role === "Picker");
