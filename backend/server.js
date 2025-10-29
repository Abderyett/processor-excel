// ────────────────────────────────────────────────────────────────
//  server.js  –  File processor + email sender + Compare & Clean
//               UPDATED (v3): Fixed CORS + Enhanced Error Handling
// ────────────────────────────────────────────────────────────────
const express      = require('express');
const multer       = require('multer');
const XLSX         = require('xlsx');
const nodemailer   = require('nodemailer');
const cors         = require('cors');
const dotenv       = require('dotenv');

dotenv.config();
const app  = express();
const PORT = process.env.PORT || 3001;

// ────────────────────────────────────────────────────────────────
//  Enhanced CORS Configuration
// ────────────────────────────────────────────────────────────────
const corsOptions = {
  origin: [
    'https://processor.vispera-dz.com',
    'https://node-processor.vispera-dz.com',
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:3001',
    // Add any other frontend domains you might use
  ],
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: [
    'Origin',
    'X-Requested-With',
    'Content-Type',
    'Accept',
    'Authorization',
  ],
  credentials: true,
  optionsSuccessStatus: 200, // For legacy browser support
};

app.use(cors(corsOptions));

// Handle preflight requests explicitly
app.options('*', cors(corsOptions));

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - Origin: ${req.get('origin')}`);
  next();
});

app.use(express.json());

// ────────────────────────────────────────────────────────────────
//  Multer (in-memory) – 50 MB / 10 files
// ────────────────────────────────────────────────────────────────
const upload = multer({
	storage: multer.memoryStorage(),
	limits : { fileSize: 50 * 1024 * 1024, files: 10 },
	fileFilter: (req, file, cb) => {
		const okMime = [
			'application/vnd.ms-excel',
			'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'text/csv',
		];
		if (okMime.includes(file.mimetype) || /\.(xlsx?|csv)$/i.test(file.originalname)) return cb(null, true);
		cb(new Error('Invalid file type. Only Excel and CSV files are allowed.'));
	},
});

// ────────────────────────────────────────────────────────────────
//  Mail transporter (Gmail SMTP) - Enhanced
// ────────────────────────────────────────────────────────────────
if (!process.env.EMAIL_USER || !(process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD))
	throw new Error('EMAIL_USER and EMAIL_PASS (or EMAIL_PASSWORD) must be set in .env');

const createTransporter = nodemailer.createTransport({
	host  : 'smtp.gmail.com',
	port  : 465,
	secure: true,
	auth  : {
		user: process.env.EMAIL_USER,
		pass: process.env.EMAIL_PASS || process.env.EMAIL_PASSWORD,
	},
	// Add connection timeout
	connectionTimeout: 60000, // 1 minute
	socketTimeout: 60000,     // 1 minute
});

// Test email connection on startup
const testEmailConnection = async () => {
  try {
    await createTransporter.verify();
    console.log('✅ Email transporter verified');
  } catch (error) {
    console.error('❌ Email transporter verification failed:', error.message);
  }
};

// ────────────────────────────────────────────────────────────────
//  Helpers
// ────────────────────────────────────────────────────────────────
const getTodayDate = () => {
	const d = new Date();
	return `${String(d.getDate()).padStart(2, '0')}_${String(d.getMonth() + 1).padStart(2, '0')}_${d.getFullYear()}`;
};

const readFileAsWorkbook = (buffer, fn) => {
	try             { return XLSX.read(buffer, { type: 'buffer', cellDates: true }); }
	catch (e)       { console.error(`Error reading ${fn}:`, e); throw new Error(`Cannot read ${fn}`); }
};

const processRow = (row, cols) => {
	const copy = { ...row };
	cols.forEach((c) => delete copy[c]);
	return copy;
};

/*────────────────────────────────────────────────────────────────
  Canonicalise PHONE - UPDATED WITH NEW FORMATTING
────────────────────────────────────────────────────────────────*/
const normalisePhone = (row) => {
	const candidates = [
		'phone_number', 'phone', 'Phone', 'Phone Number',
		'phone number', 'Phone_Number', 'PhoneNumber',
	];
	const key = candidates.find((k) => row[k] !== undefined && row[k] !== '');
	if (!key) return row;

	// Get the raw phone number and clean it
	let phone = String(row[key])
		.replace(/p:\+|p:/gi, '')  // Remove existing prefixes
		.replace(/\D/g, '')        // Remove all non-digit characters
		.trim();

	// Remove any country code prefixes
	if (phone.startsWith('033')) {
		phone = phone.slice(3);  // Remove 033
	} else if (phone.startsWith('33')) {
		phone = phone.slice(2);  // Remove 33
	} else if (phone.startsWith('213')) {
		phone = phone.slice(3);  // Remove 213
	} else if (phone.startsWith('1')) {
		phone = phone.slice(1);  // Remove any other single digit country code
	}
	
	// Add leading 0 if the number doesn't start with 0 and has 9 digits
	if (phone.length === 9 && !phone.startsWith('0')) {
		phone = '0' + phone;
	}
	
	// Format to 0770 555 999 pattern (for 10 digits)
	if (phone.length === 10) {
		phone = `${phone.slice(0, 4)} ${phone.slice(4, 7)} ${phone.slice(7)}`;
	}
	
	// Only update if we have a valid formatted number
	if (phone.length > 0) {
		row.phone_number = phone;
	}
	
	// Remove the original field if it's different from our canonical field
	if (key !== 'phone_number') {
		delete row[key];
	}
	
	return row;
};

/*────────────────────────────────────────────────────────────────
  Canonicalise FULL NAME
────────────────────────────────────────────────────────────────*/
const normaliseFullName = (row) => {
	const candidates = [
		'full_name', 'fullname', 'Full Name', 'Full_Name',
		'full name', 'FullName',
	];
	const key = candidates.find((k) => row[k] !== undefined && row[k] !== '');
	if (!key) return row;

	row.full_name = String(row[key]).trim();
	if (key !== 'full_name') delete row[key];
	return row;
};

/* Helper to apply both normalisations */
const normaliseRow = (row) => {
	normalisePhone(row);
	normaliseFullName(row);
	return row;
};

// ────────────────────────────────────────────────────────────────
//  Compare-and-Clean utilities
// ────────────────────────────────────────────────────────────────
const extractDateFromFilename = (fn) => {
	const m = fn.match(/(\d{2})_(\d{2})(?:_(\d{4}))?/);
	if (!m) return null;
	const [, dd, mm, yyyy] = m;
	return new Date(parseInt(yyyy || new Date().getFullYear(), 10),
	                parseInt(mm, 10) - 1,
	                parseInt(dd, 10));
};

const determineNewerFile = (f1, f2) => {
	const d1 = extractDateFromFilename(f1.originalname);
	const d2 = extractDateFromFilename(f2.originalname);
	if (!d1 || !d2) return f1;
	return d1 > d2 ? f1 : f2;
};

const compareAndClean = (files) => {
	if (files.length !== 2) throw new Error('Compare and Clean requires exactly 2 files');

	const [f1, f2] = files;
	const newer = determineNewerFile(f1, f2);
	const older = newer === f1 ? f2 : f1;

	const wbNewer = readFileAsWorkbook(newer.buffer, newer.originalname);
	const wbOlder = readFileAsWorkbook(older.buffer, older.originalname);

	// Collect emails from older file
	const olderEmails = new Set();
	wbOlder.SheetNames.forEach((sh) => {
		XLSX.utils.sheet_to_json(wbOlder.Sheets[sh], { defval: '' }).forEach((row) => {
			const email =
				row.email || row.Email || row.EMAIL ||
				row.email_address || row['Email Address'] ||
				row.mail || row.Mail;
			if (typeof email === 'string' && email.includes('@'))
				olderEmails.add(email.toLowerCase().trim());
		});
	});

	// Clean newer file
	const cleaned = [];
	let dupes = 0, total = 0;
	wbNewer.SheetNames.forEach((sh) => {
		XLSX.utils.sheet_to_json(wbNewer.Sheets[sh], { defval: '' }).forEach((row) => {
			total++;
			const email =
				row.email || row.Email || row.EMAIL ||
				row.email_address || row['Email Address'] ||
				row.mail || row.Mail;
			if (email && olderEmails.has(email.toLowerCase().trim())) { dupes++; return; }
			cleaned.push(row);
		});
	});

	const wbOut = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbOut, XLSX.utils.json_to_sheet(cleaned), 'Cleaned Data');
	const base = newer.originalname.replace(/\.(xlsx?|csv)$/i, '');
	const ext  = newer.originalname.match(/\.(xlsx?|csv)$/i)?.[0] || '.xlsx';

	return {
		filename          : `${base}_clean${ext}`,
		buffer            : XLSX.write(wbOut, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount          : cleaned.length,
		duplicatesRemoved : dupes,
		totalOriginalRows : total,
		olderFileName     : older.originalname,
		newerFileName     : newer.originalname,
	};
};

// ────────────────────────────────────────────────────────────────
//  ▼▼▼  THREE pipelines (each now uses normaliseRow) ▼▼▼
// ────────────────────────────────────────────────────────────────
const processLacInfo = (wbs) => {
	const out = [];
	wbs.forEach((wb) => {
		wb.SheetNames.forEach((sheet) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }).forEach((row) => {
				const r = processRow(row, [
					'id','created_time','ad_id','ad_name','adset_id','adset_name',
					'campaign_id','campaign_name','form_id','platform','is_organic','lead_status',
				]);

				r.Type = 'Piste';
				if (r.form_name !== undefined) { r.opportunité = r.form_name; delete r.form_name; }

				if (r.opportunité) {
					const v = String(r.opportunité).toLowerCase();
					if (v.includes('linfo') || v.includes('licence info') || v.includes('licence informatique') || v.includes('licence info 2025'))
						r.opportunité = 'Licence Informatique';
					else if (v.includes('lac') || v.includes('licence commerce') || v.includes('licence science commerciales') || v.includes('licence sciences commerciales année 25-26'))
						r.opportunité = 'Licence Science Commercial et marketing';
					else if (v.includes('lfc') || v.includes('licence finance'))
						r.opportunité = 'Licence Finance et Comptabilité';
				}

				normaliseRow(r);
				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbNew, XLSX.utils.json_to_sheet(out), 'Processed Data');
	return {
		filename: `ads_ifag_${getTodayDate()}.xlsx`,
		buffer  : XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount: out.length,
	};
};

const processInsagCneIf = (wbs) => {
	const out = [];
	wbs.forEach((wb) => {
		wb.SheetNames.forEach((sheet) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }).forEach((row) => {
				const r = processRow(row, [
					'id','created_time','ad_id','ad_name','adset_id','adset_name',
					'campaign_id','campaign_name','form_id','is_organic','platform',
				]);

				// Store original form_name for CNE check
				const originalFormName = r.form_name || '';

				if (r.form_name !== undefined) {
					r.opportunité = r.form_name;
					delete r.form_name;
				}

				// Fix naming conventions
				if (r.opportunité) {
					let opp = String(r.opportunité);

					// Change CNE to MBA Global CNE
					if (opp.includes('MBA Global CNE-copy')) {
						r.opportunité = 'MBA Global CNE';
					} else if (opp === 'CNE') {
						r.opportunité = 'MBA Global CNE';
					}

					// Change MBA Global Octobre to MBA Global Alger
					if (opp.includes('MBA Global Octobre')) {
						r.opportunité = 'MBA Global Alger';
					}
				}

				r.bu = 'insfag_crm_sale.business_unit_diploma_courses';

				// Track if this record has required fields
				let hasRequiredFields = false;

				// Handle different MBA Global opportunities with proper product targets
				if (r.opportunité === 'MBA Global CNE') {
					r.company = 'insfag_root.secondary_company';
					r['product cible'] = 'insfag_crm_sale.product_template_mba_mos';
					hasRequiredFields = true;
				} else if (String(r.opportunité || '').includes('MBA Global Octobre 24') ||
				           String(r.opportunité || '').includes('MBA Global Alger')) {
					r.company = 'base.main_company';
					r.source = '__export__.utm_source_11_b17eb5a0';
					r['Equipe commercial'] = '__export__.crm_team_6_3cd792db';
					r['product cible'] = 'insfag_crm_sale.product_template_mba_mos';
					hasRequiredFields = true;
				} else if (String(r.opportunité || '').includes('Exécutive MBA Finance')) {
					r.company = 'base.main_company';
					r['product cible'] = 'insfag_crm_sale.product_template_emba_sfe';
					hasRequiredFields = true;
				}

				normaliseRow(r);

				// Check if form name contains CNE
				const formNameContainsCNE = String(originalFormName).toLowerCase().includes('cne');

				// If form name contains CNE, set secondary company
				if (formNameContainsCNE) {
					r.company = 'insfag_root.secondary_company';
				}

				// Only add default source, equipe commercial for records with required fields (listed opportunities)
				if (hasRequiredFields) {
					if (!r.source) {
						r.source = '__export__.utm_source_11_b17eb5a0';
					}
					if (!r['Equipe commercial']) {
						r['Equipe commercial'] = '__export__.crm_team_6_3cd792db';
					}
				} else {
					// For unlisted opportunities: skip if they don't have source, equipe commercial, or product cible
					// OR if the form name contains CNE
					if (formNameContainsCNE || (!r.source && !r['Equipe commercial'] && !r['product cible'])) {
						return; // Skip this record
					}
				}

				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbNew, XLSX.utils.json_to_sheet(out), 'Processed Data');
	return {
		filename: `ads_insag_${getTodayDate()}.xlsx`,
		buffer  : XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount: out.length,
	};
};

const processAwareness = (wbs) => {
	const out = [];
	wbs.forEach((wb) => {
		wb.SheetNames.forEach((sheet) => {
			XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '' }).forEach((row) => {
				const r = processRow(row, [
					'id','created_time','ad_id','ad_name','adset_id','adset_name',
					'campaign_id','campaign_name','form_id','form_name','is_organic',
				]);

				if (r.platform !== undefined) { r.Type = 'Piste'; delete r.platform; }

				const longCol = 'par_quelles_formation_êtes-vous_intéressé_?';
				if (r[longCol] !== undefined) { r.opportunité = r[longCol]; delete r[longCol]; }

				if (r.opportunité) {
					const v = String(r.opportunité).toLowerCase();
					if (v.includes('linfo') || v.includes('licence info') || v.includes('licence_informatique'))
						r.opportunité = 'Licence informatique';
					else if (v.includes('lac') || v.includes('licence commerce') || v.includes('licence_commerce_&_marketing'))
						r.opportunité = 'Licence Science Commercial et marketing';
					else if (v.includes('lfc') || v.includes('licence_finance_et_comptabilité'))
						r.opportunité = 'Licence Finance et Comptabilité';
					else if (v.includes('master mm') || v.includes('master_marketing_&_management'))
						r.opportunité = 'Master Marketing Management';
					else if (v.includes('master_en_transformation_digitale_et_e-business'))
						r.opportunité = 'Master Transformation digital et E-Business';
				}

				normaliseRow(r);
				out.push(r);
			});
		});
	});

	const wbNew = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(wbNew, XLSX.utils.json_to_sheet(out), 'Processed Data');
	return {
		filename: `ads_awareness_ifag_${getTodayDate()}.xlsx`,
		buffer  : XLSX.write(wbNew, { type: 'buffer', bookType: 'xlsx', compression: true }),
		rowCount: out.length,
	};
};

// ────────────────────────────────────────────────────────────────
//  Attachments + API
// ────────────────────────────────────────────────────────────────
const makeAttachment = ({ filename, buffer }) => ({
	filename,
	content     : buffer.toString('base64'),
	encoding    : 'base64',
	contentType : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
});

// ────────────────────────────────────────────────────────────────
//  Enhanced API Route with better error handling
// ────────────────────────────────────────────────────────────────
app.post('/api/process', upload.array('files'), async (req, res) => {
	// Set timeout for long-running operations
	req.setTimeout(300000); // 5 minutes
	
	try {
		console.log('Processing request:', {
			filesCount: req.files?.length || 0,
			email: req.body.email ? 'provided' : 'missing',
			options: req.body.options || 'none'
		});

		const files = req.files;
		const opts  = JSON.parse(req.body.options || '{}');
		const email = req.body.email;

		if (!files?.length) {
			console.log('Error: No files uploaded');
			return res.status(400).json({ error: 'No files uploaded' });
		}
		
		if (!/@/.test(email||'')) {
			console.log('Error: Invalid email');
			return res.status(400).json({ error: 'Valid email required' });
		}

		const processed = [];
		const summary   = [];

		if (opts.compareAndClean) {
			if (files.length !== 2) {
				console.log('Error: Compare and Clean requires exactly 2 files');
				return res.status(400).json({ error: 'Compare and Clean requires exactly 2 files' });
			}
			console.log('Processing compare and clean...');
			const r = compareAndClean(files);
			processed.push(r);
			summary.push(`Compare & Clean → ${r.duplicatesRemoved} duplicates removed (${r.rowCount}/${r.totalOriginalRows} rows kept)`);
		} else {
			const wbs = files.map((f) => readFileAsWorkbook(f.buffer, f.originalname));
			if (opts.lacInfo)    { 
				console.log('Processing LAC Info...');
				const r = processLacInfo(wbs);    
				processed.push(r); 
				summary.push(`LAC Info: ${r.rowCount} rows`); 
			}
			if (opts.insagCneIf) { 
				console.log('Processing Insag CNE IF...');
				const r = processInsagCneIf(wbs); 
				processed.push(r); 
				summary.push(`Insag CNE IF: ${r.rowCount} rows`); 
			}
			if (opts.awareness)  { 
				console.log('Processing Awareness...');
				const r = processAwareness(wbs);  
				processed.push(r); 
				summary.push(`Awareness: ${r.rowCount} rows`); 
			}
		}

		if (!processed.length) {
			console.log('Error: No processing option selected');
			return res.status(400).json({ error: 'No processing option selected' });
		}

		console.log('Sending email with attachments...');
		await createTransporter.sendMail({
			from       : `File Processor <${process.env.EMAIL_USER}>`,
			to         : email,
			subject    : opts.compareAndClean ? 'Cleaned Excel file' : 'Processed Excel files',
			html       : `<p>Your files have been processed:</p><ul>${summary.map((s)=>`<li>${s}</li>`).join('')}</ul>`,
			attachments: processed.map(makeAttachment),
		});

		console.log('Email sent successfully');
		res.json({ success: true, filesProcessed: processed.length, details: summary });
	} catch (err) {
		console.error('Processing error:', err);
		res.status(500).json({ error: err.message });
	}
});

// ────────────────────────────────────────────────────────────────
//  Health + global error handler
// ────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => {
	res.json({ 
		status: 'OK', 
		timestamp: new Date().toISOString(),
		cors: 'enabled',
		email: process.env.EMAIL_USER ? 'configured' : 'missing'
	});
});

app.use((err, _req, res, _next) => {
	console.error('Global error handler:', err);
	if (err instanceof multer.MulterError) {
		if (err.code === 'LIMIT_FILE_SIZE')  return res.status(400).json({ error: 'File too large (max 50 MB)' });
		if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files (max 10)' });
	}
	res.status(500).json({ error: err.message });
});

// ────────────────────────────────────────────────────────────────
//  Enhanced Server Startup
// ────────────────────────────────────────────────────────────────
const startServer = async () => {
  try {
    // Test email connection
    await testEmailConnection();
    
    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📧 Email configured for: ${process.env.EMAIL_USER}`);
      console.log(`🌍 CORS enabled for production domains`);
      console.log(`🔗 Health check: http://localhost:${PORT}/health`);
    });

    // Graceful shutdown handling
    process.on('SIGTERM', () => {
      console.log('SIGTERM received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('SIGINT received, shutting down gracefully');
      server.close(() => {
        console.log('Server closed');
        process.exit(0);
      });
    });

  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
