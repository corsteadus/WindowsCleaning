import { pool } from "@workspace/db";
import { evaluateMigrationGate } from "../migrations/application-migrations.ts";

export const DEMO_SEED_CONFIRMATION = "SEED_DEMO_DATA";

export interface DemoSeedGate {
  authorizedSandbox: boolean;
  confirmationMatches: boolean;
  allowed: boolean;
  reason: string;
}

/**
 * Demo data is a destructive, exceptional operation. It is available only
 * when the request carries the exact confirmation and the runtime proves it
 * is the configured Sandbox.
 *
 * The migration gate's enable switch is forced on here because the exact
 * confirmation is this operation's deliberate opt-in. Sandbox identity
 * checks remain enforced regardless of the normal startup migration setting.
 */
export function evaluateDemoSeedGate(
  env: Record<string, string | undefined> = process.env,
  confirmation: unknown,
): DemoSeedGate {
  const confirmationMatches = confirmation === DEMO_SEED_CONFIRMATION;
  const sandboxGate = evaluateMigrationGate({
    ...env,
    APP_MIGRATIONS_ENABLED: "true",
  });
  const authorizedSandbox = sandboxGate.eligible;

  if (!confirmationMatches) {
    return {
      authorizedSandbox,
      confirmationMatches,
      allowed: false,
      reason: `confirmation must exactly match ${DEMO_SEED_CONFIRMATION}`,
    };
  }

  if (!authorizedSandbox) {
    return {
      authorizedSandbox,
      confirmationMatches,
      allowed: false,
      reason: `authorized Sandbox required: ${sandboxGate.reason}`,
    };
  }

  return {
    authorizedSandbox,
    confirmationMatches,
    allowed: true,
    reason: "authorized Sandbox demo seed",
  };
}

export interface DemoSeedResult {
  success: boolean;
  message: string;
}

export interface DemoSeedOptions {
  confirmation: unknown;
  env?: Record<string, string | undefined>;
  execute?: () => Promise<DemoSeedResult>;
}

const SEED_SQL = `
DO $$
DECLARE
  c_hartley INT; c_morrison INT; c_delgado INT; c_kim INT;
  c_nakamura INT; c_schwartz INT; c_oconnell INT; c_patel INT;
  c_reyes INT; c_fitzgerald INT; c_langford INT; c_chen INT;
  p_hartley1 INT; p_hartley2 INT; p_morrison1 INT; p_delgado1 INT;
  p_kim1 INT; p_nakamura1 INT; p_schwartz1 INT; p_schwartz2 INT;
  p_oconnell1 INT; p_patel1 INT; p_reyes1 INT; p_fitzgerald1 INT;
  p_langford1 INT; p_chen1 INT;
  crew_alpha INT; crew_beta INT;
  svc_ext INT; svc_full INT; svc_screen INT;
  svc_track INT; svc_hardwater INT; svc_cco INT;
  q1 INT; q2 INT; q3 INT; q4 INT; q5 INT; q6 INT; q7 INT; q8 INT;
  j1 INT; j2 INT; j3 INT; j4 INT; j5 INT; j6 INT;
  j7 INT; j8 INT; j9 INT; j10 INT; j11 INT; j12 INT;
  j13 INT; j14 INT; j15 INT; j16 INT; j17 INT; j18 INT;
BEGIN

TRUNCATE TABLE tasks, recurring_plans, invoices, quote_line_items,
               quotes, jobs, contacts, leads, properties,
               customers, services, crews
  RESTART IDENTITY CASCADE;

INSERT INTO services (name, description, category, pricing_type, base_price, unit, estimated_duration, is_active) VALUES
  ('Exterior Window Cleaning',  'Full exterior clean, squeegee finish, frames wiped',                      'window_cleaning','flat',     120.00,'job',    90,  true),
  ('Interior + Exterior Clean', 'Complete inside and outside window service, tracks included',             'window_cleaning','flat',     200.00,'job',    150, true),
  ('Screen Cleaning',           'Remove, wash, dry, and reinstall all window screens',                     'window_cleaning','per_unit',   8.00,'screen', 45,  true),
  ('Track & Frame Detail',      'Deep clean window tracks, frames, and sills',                             'window_cleaning','flat',      65.00,'job',    60,  true),
  ('Hard Water Removal',        'Chemical treatment to remove mineral deposits from glass',                'window_cleaning','per_unit',  35.00,'pane',   90,  true),
  ('Post-Construction Cleanup', 'Remove paint, stucco, adhesive, and debris from new construction glass', 'window_cleaning','per_unit',  55.00,'pane',   120, true);

SELECT id INTO svc_ext       FROM services WHERE name = 'Exterior Window Cleaning';
SELECT id INTO svc_full      FROM services WHERE name = 'Interior + Exterior Clean';
SELECT id INTO svc_screen    FROM services WHERE name = 'Screen Cleaning';
SELECT id INTO svc_track     FROM services WHERE name = 'Track & Frame Detail';
SELECT id INTO svc_hardwater FROM services WHERE name = 'Hard Water Removal';
SELECT id INTO svc_cco       FROM services WHERE name = 'Post-Construction Cleanup';

INSERT INTO crews (name, lead_technician, phone, email, members, is_active, color, notes) VALUES
  ('Alpha Crew','Mike Rodriguez','(602) 555-0141','alpha@winvuecrm.com','Mike Rodriguez, Carlos Vega',        true,'#3b82f6','Primary residential crew. Excellent customer feedback.'),
  ('Beta Crew', 'Sarah Chen',    '(602) 555-0192','beta@winvuecrm.com', 'Sarah Chen, Jordan Phelps, Ty Okafor',true,'#10b981','Commercial specialist crew. High-rise certified.');

SELECT id INTO crew_alpha FROM crews WHERE name = 'Alpha Crew';
SELECT id INTO crew_beta  FROM crews WHERE name = 'Beta Crew';

INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('Robert','Hartley','r.hartley@email.com','(480) 555-0211','4820 E Camelback Rd','Scottsdale','AZ','85251','referral','vip,residential','Referred by Morrison. Always tips crew well.','active','email') RETURNING id INTO c_hartley;
INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('Susan','Morrison','s.morrison@morrisonrealty.com','(480) 555-0334','8901 N Pima Rd Ste 200','Scottsdale','AZ','85258','google','commercial,property-mgmt','Manages 6 properties. Invoices go to billing dept.','active','email') RETURNING id INTO c_morrison;
INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('Carlos','Delgado','carlos.delgado@gmail.com','(602) 555-0455','1133 W McDowell Rd','Phoenix','AZ','85007','yelp','residential','','active','phone') RETURNING id INTO c_delgado;
INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('Ji-Yeon','Kim','jykim@kimfamilyhomes.net','(480) 555-0577','2200 E Ocotillo Rd','Chandler','AZ','85249','referral','residential,vip','Very detail-oriented. Always request Mike from Alpha Crew.','active','text') RETURNING id INTO c_kim;
INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('David','Nakamura','dnakamura@sunsetprops.com','(480) 555-0688','15505 N Hayden Rd Ste 100','Scottsdale','AZ','85260','google','commercial,restaurant','Storefront glass. Early morning only before 7am.','active','phone') RETURNING id INTO c_nakamura;
INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('Rachel','Schwartz','rachel.schwartz@swarthomes.com','(480) 555-0799','6200 E Shea Blvd','Scottsdale','AZ','85254','nextdoor','residential','','active','email') RETURNING id INTO c_schwartz;
INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('Patrick','OConnell','poconnell@oconnelllaw.com','(602) 555-0812','3300 N Central Ave Ste 1800','Phoenix','AZ','85012','referral','commercial,law-office','Pays immediately upon receipt. High-rise suite.','active','email') RETURNING id INTO c_oconnell;
INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('Priya','Patel','priya@pateldesignstudio.com','(480) 555-0921','7100 E Lincoln Dr','Paradise Valley','AZ','85253','instagram','residential,luxury','New client. 3-story custom home. Requires ladder cert.','active','email') RETURNING id INTO c_patel;
INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('Marco','Reyes','marco.reyes@gmail.com','(623) 555-0133','18900 N 107th Ave','Sun City','AZ','85373','yelp','residential,senior','Senior discount applied. Slow payer — net 45.','active','phone') RETURNING id INTO c_reyes;
INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('Amanda','Fitzgerald','afitz@fitz-consulting.com','(480) 555-0244','20750 N 87th St','Scottsdale','AZ','85255','google','residential','','active','text') RETURNING id INTO c_fitzgerald;
INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('Tom','Langford','tlangford@langfordbuilt.com','(602) 555-0355','4500 S 40th St','Phoenix','AZ','85040','referral','commercial,construction','Builder. Sends post-construction cleanup jobs regularly.','active','email') RETURNING id INTO c_langford;
INSERT INTO customers (first_name,last_name,email,phone,billing_address,billing_city,billing_state,billing_zip,source,tags,notes,status,preferred_contact_method)
VALUES ('Linda','Chen','lchen@gmail.com','(480) 555-0466','9801 E Happy Valley Rd','Scottsdale','AZ','85255','nextdoor','residential','Cancelled twice — reschedule with 48hr notice required.','inactive','phone') RETURNING id INTO c_chen;

INSERT INTO properties (customer_id,name,address,city,state,zip,property_type,stories,window_count,access_notes,gate_code,has_screens,has_hard_water,has_tracks,service_notes)
VALUES (c_hartley,'Main Residence','4820 E Camelback Rd','Scottsdale','AZ','85251','residential',2,28,'Side gate code below. Dog in backyard.','1847#',true,true,true,'Hard water on rear windows. Use Aqua Buff.') RETURNING id INTO p_hartley1;
INSERT INTO properties (customer_id,name,address,city,state,zip,property_type,stories,window_count,access_notes,has_screens,has_hard_water,service_notes)
VALUES (c_hartley,'Guest House','4822 E Camelback Rd','Scottsdale','AZ','85251','residential',1,8,'Unlocked shed on left.',false,false,'Small casita. Usually done same day as main house.') RETURNING id INTO p_hartley2;
INSERT INTO properties (customer_id,name,address,city,state,zip,property_type,stories,window_count,access_notes,has_screens,has_hard_water,has_tracks,service_notes)
VALUES (c_morrison,'Scottsdale Office Plaza','8901 N Pima Rd Ste 200','Scottsdale','AZ','85258','commercial',2,44,'Check in with front desk. Park in visitor lot B.',false,false,true,'Exterior only. Coordinate with property manager Greg (480-555-0300).') RETURNING id INTO p_morrison1;
INSERT INTO properties (customer_id,address,city,state,zip,property_type,stories,window_count,has_screens,service_notes)
VALUES (c_delgado,'1133 W McDowell Rd','Phoenix','AZ','85007','residential',1,16,true,'Single story ranch. Straightforward job.') RETURNING id INTO p_delgado1;
INSERT INTO properties (customer_id,name,address,city,state,zip,property_type,stories,window_count,gate_code,has_screens,has_hard_water,has_tracks,service_notes)
VALUES (c_kim,'Family Home','2200 E Ocotillo Rd','Chandler','AZ','85249','residential',2,34,'2281',true,true,true,'Always request Alpha Crew. Ji-Yeon inspects every window.') RETURNING id INTO p_kim1;
INSERT INTO properties (customer_id,name,address,city,state,zip,property_type,stories,window_count,access_notes,has_hard_water,service_notes)
VALUES (c_nakamura,'Sonoran Grille','15505 N Hayden Rd','Scottsdale','AZ','85260','commercial',1,18,'Must arrive before 7am. Manager opens at 6:45am.',true,'Front facade storefront glass. Hard water from sprinklers.') RETURNING id INTO p_nakamura1;
INSERT INTO properties (customer_id,name,address,city,state,zip,property_type,stories,window_count,has_screens,has_hard_water,service_notes)
VALUES (c_schwartz,'Shea Blvd Home','6200 E Shea Blvd','Scottsdale','AZ','85254','residential',2,22,true,false,'') RETURNING id INTO p_schwartz1;
INSERT INTO properties (customer_id,name,address,city,state,zip,property_type,stories,window_count,access_notes,has_screens,service_notes)
VALUES (c_schwartz,'Rental Condo','7300 E Earll Dr #204','Scottsdale','AZ','85251','residential',1,10,'Call tenant Dana first: 480-555-0811.',true,'Tenant prefers weekday morning appointments.') RETURNING id INTO p_schwartz2;
INSERT INTO properties (customer_id,name,address,city,state,zip,property_type,stories,window_count,access_notes,has_hard_water,service_notes)
VALUES (c_oconnell,'OConnell Law Offices','3300 N Central Ave Ste 1800','Phoenix','AZ','85012','commercial',18,60,'High-rise. Use freight elevator #3 with code 4419.',false,'Beta Crew only — high-rise certified. Exterior from rope access.') RETURNING id INTO p_oconnell1;
INSERT INTO properties (customer_id,name,address,city,state,zip,property_type,stories,window_count,access_notes,gate_code,has_screens,has_hard_water,has_tracks,service_notes)
VALUES (c_patel,'Paradise Valley Estate','7100 E Lincoln Dr','Paradise Valley','AZ','85253','residential',3,52,'Call 20 mins before arrival. Guard gate.','7710#',false,true,true,'New client. Ladder work on 3rd floor. Crew must be certified.') RETURNING id INTO p_patel1;
INSERT INTO properties (customer_id,address,city,state,zip,property_type,stories,window_count,has_screens,service_notes)
VALUES (c_reyes,'18900 N 107th Ave','Sun City','AZ','85373','residential',1,14,true,'Senior discount: 10% off. Net 45.') RETURNING id INTO p_reyes1;
INSERT INTO properties (customer_id,address,city,state,zip,property_type,stories,window_count,has_screens,has_hard_water,service_notes)
VALUES (c_fitzgerald,'20750 N 87th St','Scottsdale','AZ','85255','residential',2,26,true,false,'') RETURNING id INTO p_fitzgerald1;
INSERT INTO properties (customer_id,name,address,city,state,zip,property_type,stories,window_count,access_notes,has_hard_water,service_notes)
VALUES (c_langford,'Langford Build Site — Arcadia','4200 E Camelback Rd','Phoenix','AZ','85018','commercial',2,36,'Active construction site. Hard hat required. Contact Jose: 602-555-0700.',true,'Post-construction cleanup. Stucco and paint overspray.') RETURNING id INTO p_langford1;
INSERT INTO properties (customer_id,address,city,state,zip,property_type,stories,window_count,has_screens,service_notes)
VALUES (c_chen,'9801 E Happy Valley Rd','Scottsdale','AZ','85255','residential',2,20,true,'Inactive customer — confirm before scheduling.') RETURNING id INTO p_chen1;

INSERT INTO contacts (customer_id,first_name,last_name,email,phone,role,is_primary,receive_sms,receive_email) VALUES
  (c_morrison,'Greg','Tillman','gtillman@morrisonrealty.com','(480) 555-0300','Property Manager',false,true,true),
  (c_nakamura,'Ana','Torres','ana.torres@sonorangrille.com','(480) 555-0645','General Manager',false,true,false),
  (c_oconnell,'Patricia','Walsh','pwalsh@oconnelllaw.com','(602) 555-0813','Office Administrator',false,true,true),
  (c_langford,'Jose','Herrera','jherrera@langfordbuilt.com','(602) 555-0700','Site Foreman',false,true,false),
  (c_patel,'Ravi','Patel','ravi.patel@gmail.com','(480) 555-0922','Spouse / Decision Maker',false,false,true);

INSERT INTO leads (first_name,last_name,email,phone,source,status,notes,address,city,state,zip,estimated_value,follow_up_date,assigned_to) VALUES
  ('Brandon','Walsh','bwalsh@email.com','(480) 555-0501','google','new','Filled out contact form. Interested in full window and screen service.','1400 E Turney Ave','Phoenix','AZ','85014',280.00,'2026-04-01','Lute Atieh'),
  ('Diane','Kowalski','dkowalski@azbiz.com','(602) 555-0522','referral','contacted','Referred by Kim. Has 3-bed 2-story home. Left voicemail 3/27.','1850 N 68th St','Scottsdale','AZ','85257',220.00,'2026-04-02','Lute Atieh'),
  ('Frank','Alvarez','falvarez@gmail.com','(623) 555-0543','yelp','estimate_scheduled','Scheduled estimate for April 3 at 10am. Commercial car dealership.','10500 W McDowell Rd','Avondale','AZ','85392',1200.00,'2026-04-03','Lute Atieh'),
  ('Cynthia','James','cynj@email.com','(480) 555-0564','nextdoor','quote_sent','Quote sent 3/20. Waiting for approval. 2-story home, 24 windows.','3300 N Miller Rd','Scottsdale','AZ','85251',310.00,'2026-04-04','Lute Atieh'),
  ('Victor','Estrada','vestrada@realty.net','(602) 555-0585','google','quote_sent','HOA common area. Quote sent. Decision by committee — expect delay.','7200 N 16th St','Phoenix','AZ','85020',850.00,'2026-04-08','Lute Atieh'),
  ('Tanya','Brooks','tbrooks@tbrooks.com','(480) 555-0606','instagram','won','Converted to customer. Booked for April 10.','5100 E Thomas Rd','Scottsdale','AZ','85251',190.00,NULL,NULL),
  ('Gary','Mercer','gmercer@email.com','(602) 555-0627','google','lost','Went with competitor — price too high. May revisit in fall.','2900 N 7th Ave','Phoenix','AZ','85013',160.00,NULL,NULL),
  ('Hana','Suzuki','hana.suzuki@outlook.com','(480) 555-0648','referral','new','Called this morning. Interested in recurring quarterly plan.','11500 E Via Linda','Scottsdale','AZ','85259',350.00,'2026-04-01','Lute Atieh');

INSERT INTO quotes (customer_id,property_id,quote_number,status,subtotal,tax_total,discount_total,total_amount,notes,valid_until)
VALUES (c_hartley,p_hartley1,'Q-2026-001','approved',265.00,0,0,265.00,'Exterior clean + screen cleaning for main residence.','2026-04-15') RETURNING id INTO q1;
INSERT INTO quotes (customer_id,property_id,quote_number,status,subtotal,tax_total,discount_total,total_amount,notes,valid_until)
VALUES (c_kim,p_kim1,'Q-2026-002','approved',385.00,0,0,385.00,'Interior + exterior + track detail. Alpha Crew requested.','2026-04-20') RETURNING id INTO q2;
INSERT INTO quotes (customer_id,property_id,quote_number,status,subtotal,tax_total,discount_total,total_amount,notes,valid_until)
VALUES (c_patel,p_patel1,'Q-2026-003','sent',680.00,0,0,680.00,'3-story estate: interior + exterior, tracks, screens. Ladder cert required.','2026-04-25') RETURNING id INTO q3;
INSERT INTO quotes (customer_id,property_id,quote_number,status,subtotal,tax_total,discount_total,total_amount,notes,valid_until)
VALUES (c_oconnell,p_oconnell1,'Q-2026-004','approved',1100.00,0,0,1100.00,'High-rise exterior — Beta Crew rope access. 60 windows.','2026-04-30') RETURNING id INTO q4;
INSERT INTO quotes (customer_id,property_id,quote_number,status,subtotal,tax_total,discount_total,total_amount,notes,valid_until)
VALUES (c_langford,p_langford1,'Q-2026-005','approved',1980.00,0,0,1980.00,'Post-construction: 36 panes, stucco/paint removal.','2026-04-10') RETURNING id INTO q5;
INSERT INTO quotes (customer_id,property_id,quote_number,status,subtotal,tax_total,discount_total,total_amount,notes,valid_until)
VALUES (c_fitzgerald,p_fitzgerald1,'Q-2026-006','sent',275.00,0,0,275.00,'Full clean + screen wash. Sent 3/25.','2026-04-25') RETURNING id INTO q6;
INSERT INTO quotes (customer_id,property_id,quote_number,status,subtotal,tax_total,discount_total,total_amount,notes,valid_until)
VALUES (c_morrison,p_morrison1,'Q-2026-007','draft',520.00,0,0,520.00,'Quarterly commercial exterior — 44 windows.','2026-05-01') RETURNING id INTO q7;
INSERT INTO quotes (customer_id,property_id,quote_number,status,subtotal,tax_total,discount_total,total_amount,notes,valid_until)
VALUES (c_schwartz,p_schwartz1,'Q-2026-008','rejected',230.00,0,0,230.00,'Exterior + screens. Client declined — rescheduling for summer.','2026-04-01') RETURNING id INTO q8;

INSERT INTO quote_line_items (quote_id,service_id,description,quantity,unit_price,total_price,sort_order) VALUES
  (q1,svc_ext,'Exterior Window Cleaning — 28 windows',1,120.00,120.00,1),
  (q1,svc_screen,'Screen Cleaning — 18 screens',18,8.00,144.00,2),
  (q2,svc_full,'Interior + Exterior Clean — 34 windows',1,200.00,200.00,1),
  (q2,svc_track,'Track & Frame Detail',1,65.00,65.00,2),
  (q2,svc_screen,'Screen Cleaning — 15 screens',15,8.00,120.00,3),
  (q3,svc_full,'Interior + Exterior — 52 windows',1,200.00,200.00,1),
  (q3,svc_screen,'Screen Cleaning — 30 screens',30,8.00,240.00,2),
  (q3,svc_track,'Track & Frame Detail',1,65.00,65.00,3),
  (q3,svc_hardwater,'Hard Water Removal — 9 panes',9,35.00,315.00,4),
  (q4,svc_ext,'High-Rise Exterior — 60 windows',1,200.00,200.00,1),
  (q4,svc_ext,'Rope Access Surcharge',1,900.00,900.00,2),
  (q5,svc_cco,'Post-Construction Cleanup — 36 panes',36,55.00,1980.00,1),
  (q6,svc_full,'Interior + Exterior — 26 windows',1,200.00,200.00,1),
  (q6,svc_screen,'Screen Cleaning — 10 screens',10,8.00,80.00,2),
  (q7,svc_ext,'Exterior Window Cleaning — 44 windows',1,520.00,520.00,1),
  (q8,svc_ext,'Exterior Window Cleaning — 22 windows',1,120.00,120.00,1),
  (q8,svc_screen,'Screen Cleaning — 14 screens',14,8.00,112.00,2);

INSERT INTO jobs (customer_id,property_id,quote_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes,completed_at)
VALUES (c_hartley,p_hartley1,q1,crew_alpha,'JOB-2026-001','completed','Exterior + Screens','2026-03-05','08:00','10:30',150,265.00,'Main residence.','2026-03-05T10:28:00') RETURNING id INTO j1;
INSERT INTO jobs (customer_id,property_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes,completed_at)
VALUES (c_delgado,p_delgado1,crew_alpha,'JOB-2026-002','completed','Exterior Window Cleaning','2026-03-08','09:00','11:00',90,120.00,'Straightforward residential.','2026-03-08T10:55:00') RETURNING id INTO j2;
INSERT INTO jobs (customer_id,property_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes,completed_at)
VALUES (c_morrison,p_morrison1,crew_beta,'JOB-2026-003','completed','Commercial Exterior','2026-03-12','06:00','10:00',180,520.00,'Q1 exterior clean.','2026-03-12T09:50:00') RETURNING id INTO j3;
INSERT INTO jobs (customer_id,property_id,quote_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes,completed_at)
VALUES (c_langford,p_langford1,q5,crew_beta,'JOB-2026-004','completed','Post-Construction Cleanup','2026-03-15','07:00','12:00',300,1980.00,'Arcadia build site. Stucco overspray.','2026-03-15T11:45:00') RETURNING id INTO j4;
INSERT INTO jobs (customer_id,property_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes,completed_at)
VALUES (c_reyes,p_reyes1,crew_alpha,'JOB-2026-005','completed','Exterior Window Cleaning','2026-03-18','10:00','12:00',90,108.00,'Senior discount 10% applied.','2026-03-18T11:50:00') RETURNING id INTO j5;
INSERT INTO jobs (customer_id,property_id,quote_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes,completed_at)
VALUES (c_kim,p_kim1,q2,crew_alpha,'JOB-2026-006','completed','Full Clean + Tracks + Screens','2026-03-22','08:00','11:30',210,385.00,'Ji-Yeon inspected all windows — very happy.','2026-03-22T11:20:00') RETURNING id INTO j6;
INSERT INTO jobs (customer_id,property_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes)
VALUES (c_schwartz,p_schwartz1,crew_alpha,'JOB-2026-007','scheduled','Exterior Window Cleaning','2026-03-29','08:30','11:00',120,120.00,'Call Rachel 30 mins before arrival.') RETURNING id INTO j7;
INSERT INTO jobs (customer_id,property_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes)
VALUES (c_nakamura,p_nakamura1,crew_alpha,'JOB-2026-008','in_progress','Hard Water + Exterior','2026-03-29','06:00','08:00',90,245.00,'Early AM — must finish before restaurant opens.') RETURNING id INTO j8;
INSERT INTO jobs (customer_id,property_id,quote_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes)
VALUES (c_oconnell,p_oconnell1,q4,crew_beta,'JOB-2026-009','scheduled','High-Rise Exterior','2026-03-29','07:00','14:00',360,1100.00,'Beta Crew rope access. Freight elevator code: 4419.') RETURNING id INTO j9;
INSERT INTO jobs (customer_id,property_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes)
VALUES (c_hartley,p_hartley2,crew_alpha,'JOB-2026-010','scheduled','Exterior Window Cleaning','2026-04-02','11:00','12:00',60,80.00,'Guest house — quick job after main residence.') RETURNING id INTO j10;
INSERT INTO jobs (customer_id,property_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes)
VALUES (c_fitzgerald,p_fitzgerald1,crew_alpha,'JOB-2026-011','scheduled','Full Clean + Screens','2026-04-03','09:00','12:00',150,275.00,'Quote approved verbally — send invoice after.') RETURNING id INTO j11;
INSERT INTO jobs (customer_id,property_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes)
VALUES (c_schwartz,p_schwartz2,crew_alpha,'JOB-2026-012','scheduled','Exterior Window Cleaning','2026-04-05','10:00','11:30',80,95.00,'Rental condo — call tenant Dana first: 480-555-0811.') RETURNING id INTO j12;
INSERT INTO jobs (customer_id,property_id,quote_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes)
VALUES (c_patel,p_patel1,q3,crew_beta,'JOB-2026-013','scheduled','Full 3-Story Estate Clean','2026-04-08','08:00','15:00',420,680.00,'Paradise Valley estate. Guard gate code 7710#.') RETURNING id INTO j13;
INSERT INTO jobs (customer_id,property_id,crew_id,job_number,status,service_type,scheduled_date,scheduled_start_time,scheduled_end_time,estimated_duration,total_amount,notes)
VALUES (c_morrison,p_morrison1,crew_beta,'JOB-2026-014','scheduled','Commercial Exterior','2026-04-12','06:00','10:00',180,520.00,'Q2 quarterly commercial service.') RETURNING id INTO j14;
INSERT INTO jobs (customer_id,property_id,job_number,status,service_type,total_amount,notes)
VALUES (c_delgado,p_delgado1,'JOB-2026-015','scheduled','Exterior Window Cleaning',120.00,'Called to rebook — date TBD. Reach out to schedule.') RETURNING id INTO j15;
INSERT INTO jobs (customer_id,property_id,job_number,status,service_type,total_amount,notes)
VALUES (c_reyes,p_reyes1,'JOB-2026-016','scheduled','Exterior + Screen Clean',186.00,'Spring clean. Marco wants April, no specific date yet.') RETURNING id INTO j16;
INSERT INTO jobs (customer_id,property_id,job_number,status,service_type,total_amount,notes)
VALUES (c_kim,p_kim1,'JOB-2026-017','scheduled','Full Clean + Tracks',265.00,'Q2 service. Ji-Yeon wants April 15-20 range. Awaiting confirmation.') RETURNING id INTO j17;
INSERT INTO jobs (customer_id,property_id,job_number,status,service_type,total_amount,notes)
VALUES (c_nakamura,p_nakamura1,'JOB-2026-018','scheduled','Hard Water + Exterior',245.00,'Monthly storefront. Early AM slot required. Date TBD.') RETURNING id INTO j18;

INSERT INTO invoices (customer_id,job_id,invoice_number,status,subtotal,tax_amount,total_amount,amount_paid,balance_due,due_date,paid_at,notes) VALUES
  (c_hartley,j1,'INV-2026-001','paid',265.00,0,265.00,265.00,0.00,'2026-03-15','2026-03-10','Paid by Zelle same day.'),
  (c_delgado,j2,'INV-2026-002','paid',120.00,0,120.00,120.00,0.00,'2026-03-20','2026-03-14',NULL),
  (c_morrison,j3,'INV-2026-003','paid',520.00,0,520.00,520.00,0.00,'2026-03-25','2026-03-20','Net 30. Paid on time.'),
  (c_langford,j4,'INV-2026-004','paid',1980.00,0,1980.00,1980.00,0.00,'2026-03-25','2026-03-22','Paid by ACH.'),
  (c_kim,j6,'INV-2026-005','paid',385.00,0,385.00,385.00,0.00,'2026-03-30','2026-03-25','Paid immediately. Great client.'),
  (c_reyes,j5,'INV-2026-006','sent',108.00,0,108.00,0.00,108.00,'2026-04-02',NULL,'Net 45. Follow up if unpaid by 4/5.'),
  (c_oconnell,j9,'INV-2026-007','sent',1100.00,0,1100.00,0.00,1100.00,'2026-04-28',NULL,'Will pay within 5 days of job completion.'),
  (c_schwartz,j7,'INV-2026-008','draft',120.00,0,120.00,0.00,120.00,'2026-04-12',NULL,'Send after job completes today.'),
  (c_nakamura,j8,'INV-2026-009','sent',245.00,0,245.00,0.00,245.00,'2026-04-12',NULL,'Send after today job.'),
  (c_patel,NULL,'INV-2026-010','draft',200.00,0,200.00,0.00,200.00,'2026-04-22',NULL,'Deposit invoice for upcoming estate clean.'),
  (c_reyes,NULL,'INV-2026-011','overdue',86.00,0,86.00,0.00,86.00,'2026-03-01',NULL,'Dec service — missed payment. Called 3 times. Net 45 expired.'),
  (c_chen,NULL,'INV-2026-012','overdue',145.00,0,145.00,0.00,145.00,'2026-02-28',NULL,'Customer inactive. Send to collections if unpaid by 4/1.');

INSERT INTO recurring_plans (customer_id,property_id,crew_id,name,status,frequency_type,interval_value,preferred_day_of_week,preferred_time_window,next_run_date,service_type,estimated_amount,auto_generate_jobs,default_service_notes,default_duration_minutes) VALUES
  (c_hartley,p_hartley1,crew_alpha,'Hartley Quarterly Exterior','active','quarterly',3,'Saturday','Morning (8-11am)','2026-06-05','Exterior Window Cleaning','265.00',false,'Main residence. Dog in backyard — gate code 1847#.',150),
  (c_morrison,p_morrison1,crew_beta,'Morrison Plaza Quarterly','active','quarterly',3,'Thursday','Early AM (6-9am)','2026-06-12','Commercial Exterior','520.00',false,'Coordinate with Greg Tillman. Park in visitor lot B.',180),
  (c_nakamura,p_nakamura1,crew_alpha,'Sonoran Grille Monthly Storefront','active','monthly',1,'Sunday','Early AM (6-7:30am)','2026-04-26','Hard Water + Exterior','245.00',true,'Before restaurant opens at 7am.',90),
  (c_kim,p_kim1,crew_alpha,'Kim Family Biannual Full Clean','active','quarterly',6,'Saturday','Morning (8-11am)','2026-09-22','Full Clean + Tracks','385.00',false,'Alpha Crew only. Ji-Yeon inspects everything.',210),
  (c_schwartz,p_schwartz2,crew_alpha,'Schwartz Rental Annual','active','yearly',12,'Wednesday','Morning (10am-12pm)','2027-04-05','Exterior Window Cleaning','95.00',false,'Call tenant Dana first: 480-555-0811.',90);

INSERT INTO tasks (related_type,related_id,title,description,status,priority,due_at,assigned_to) VALUES
  ('customer',c_reyes,'Follow up on overdue invoices — Marco Reyes','Marco has 2 overdue invoices totaling $194. Call (623) 555-0133 and offer payment plan.','pending','high','2026-03-30','Lute Atieh'),
  ('customer',c_chen,'Send collections notice — Linda Chen','INV-2026-012 ($145) is 30+ days overdue. Customer inactive. Send final notice before April 1.','pending','high','2026-04-01','Lute Atieh'),
  ('job',j13,'Confirm guard gate access for Patel estate','Call Priya at 480-555-0921 to verify gate code 7710# is still valid for April 8 job.','pending','normal','2026-04-05','Lute Atieh'),
  ('customer',c_fitzgerald,'Follow up on Q-2026-006 — Fitzgerald','Quote sent 3/25. No response yet. Email afitz@fitz-consulting.com to follow up.','pending','normal','2026-04-01','Lute Atieh'),
  ('job',j8,'Confirm Alpha Crew on site at Nakamura by 6am','Text Mike Rodriguez tonight to confirm crew arrives at Sonoran Grille by 6am.','completed','high','2026-03-29','Lute Atieh'),
  ('customer',c_patel,'Verify Beta Crew ladder certification for Patel job','3-story estate requires high-rise certified crew. Confirm Sarah Chen certs are current.','pending','normal','2026-04-04','Lute Atieh'),
  (NULL,NULL,'Reorder Aqua Buff hard water solution','Running low — order 6 units. Used on Hartley and Nakamura jobs regularly.','pending','low','2026-04-03','Lute Atieh'),
  ('customer',c_morrison,'Finalize and send Q-2026-007 Morrison Plaza quote','Draft quote ready. Review pricing then send to Susan Morrison for Q2 approval.','pending','normal','2026-04-05','Lute Atieh'),
  ('customer',c_langford,'Follow up on new Langford build site referrals','Tom mentioned 2 new sites in Mesa. Schedule post-construction estimates.','pending','low','2026-04-10','Lute Atieh'),
  (NULL,NULL,'Renew general liability insurance certificate','Certificate expires April 30. Request updated cert from broker immediately.','pending','high','2026-04-15','Lute Atieh');

END $$;
`;

export async function seedDemoData(
  options: DemoSeedOptions = { confirmation: undefined },
): Promise<DemoSeedResult> {
  const gate = evaluateDemoSeedGate(options.env, options.confirmation);
  if (!gate.allowed) {
    return { success: false, message: `Demo seed denied: ${gate.reason}` };
  }
  if (options.execute) return options.execute();

  const client = await pool.connect();
  try {
    await client.query(SEED_SQL);
    return { success: true, message: "Demo data seeded successfully." };
  } catch (err) {
    console.error("Seed failed:", err);
    return { success: false, message: String(err) };
  } finally {
    client.release();
  }
}
