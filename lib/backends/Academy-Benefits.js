const sql = require('mssql');
const strftime = require('strftime');
const { checkString, nameCase, formatAddress } = require('../Utils');
const { Systems } = require('../Constants');

let config = {
  user: process.env.Academy_user,
  password: process.env.Academy_password,
  server: process.env.Academy_server,
  database: process.env.Academy_database
};

const pool = new sql.ConnectionPool(config);

pool.on('error', err => {
  console.log(err);
});

pool.connect();

async function runSearchQuery(queryParams) {
  let whereClause = [];
  await pool;

  let request = pool.request();

  if (queryParams.firstName && queryParams.firstName !== '') {
    request.input(
      'forename',
      sql.NVarChar,
      `%${queryParams.firstName.toUpperCase()}%`
    );
    whereClause.push('forename LIKE @forename');
  }

  if (queryParams.lastName && queryParams.lastName !== '') {
    request.input(
      'surname',
      sql.NVarChar,
      `%${queryParams.lastName.toUpperCase()}%`
    );
    whereClause.push('surname LIKE @surname');
  }
  whereClause = whereClause.map(clause => `(${clause})`);

  let query = `SELECT
  hbmember.claim_id,
  hbmember.person_ref,
	hbmember.forename,
	hbmember.surname,
	hbmember.birth_date,
	hbmember.nino,
	hbhousehold.addr1,
	hbhousehold.addr2,
	hbhousehold.addr3,
	hbhousehold.addr4,
	hbhousehold.post_code
FROM
	hbmember
	LEFT JOIN hbhousehold ON hbmember.claim_id = hbhousehold.claim_id
		AND hbmember.house_id = hbhousehold.house_id
WHERE
	hbhousehold.to_date = '2099-12-31'
	AND(${whereClause.join(' AND ')})`;

  return await request.query(query);
}

async function runFetchQuery(id) {
  await pool;

  let request = pool.request();

  let [claim_id, person_ref] = id.split('/');

  request.input('claim_id', sql.NVarChar, claim_id);
  request.input('person_ref', sql.Int, person_ref);
  let query = `SELECT
  hbmember.claim_id,
  hbmember.title,
	hbmember.forename,
	hbmember.surname,
	hbmember.birth_date,
	hbmember.nino,
	hbhousehold.addr1,
	hbhousehold.addr2,
	hbhousehold.addr3,
	hbhousehold.addr4,
	hbhousehold.post_code
FROM
	hbmember
	LEFT JOIN hbhousehold ON hbmember.claim_id = hbhousehold.claim_id
		AND hbmember.house_id = hbhousehold.house_id
WHERE hbmember.claim_id = @claim_id
  AND hbmember.person_ref = @person_ref`;

  try {
    return await request.query(query);
  } catch (err) {
    console.log(err);
  }
}

async function fetchBenefits(id){
  await pool;

  let request = pool.request();

  let [claim_id, person_ref] = id.split('/');

  request.input('claim_id', sql.NVarChar, claim_id);
  let query = `SELECT
	hbincome.inc_amt as amount,
	hbincome.freq_len,
	hbincome.freq_period,
	hbinccode.descrip1 as description
FROM
	hbincome
	JOIN hbhousehold ON hbincome.claim_id = hbhousehold.claim_id AND hbincome.house_id = hbhousehold.house_id
	JOIN hbinccode ON hbinccode.code = hbincome.inc_code AND hbinccode.to_date = '2099-12-31'
WHERE
	hbhousehold.to_date = '2099-12-31'
	AND hbincome.claim_id = @claim_id;`;

  try {
    return await request.query(query);
  } catch (err) {
    console.log(err);
  }
}

async function fetchHousehold(id){
  await pool;

  let request = pool.request();

  let [claim_id, person_ref] = id.split('/');

  request.input('claim_id', sql.NVarChar, claim_id);
  request.input('person_ref', sql.Int, person_ref);
  let query = `SELECT
	title,
	forename as first,
	surname as last,
	birth_date as dob
FROM
	hbmember
	JOIN hbhousehold ON hbmember.claim_id = hbhousehold.claim_id
		AND hbmember.house_id = hbhousehold.house_id
WHERE
	hbhousehold.to_date = '2099-12-31'
	AND hbmember.claim_id = @claim_id
	AND hbmember.person_ref != @person_ref;`;

  try {
    return await request.query(query);
  } catch (err) {
    console.log(err);
  }
}


let processSearchResults = function(results) {
  return results.recordset.map(record => {
    return {
      id: `${record.claim_id}/${record.person_ref}`,
      firstName: checkString(record.forename),
      lastName: checkString(record.surname),
      dob: record.birth_date ? strftime('%d/%m/%Y', record.birth_date) : null,
      nino: checkString(record.nino),
      address: formatAddress(
        [
          record.addr1.trim(),
          record.addr2.trim(),
          record.addr3.trim(),
          record.addr4.trim(),
          record.post_code.trim()
        ]
          .filter(x => x !== '')
          .join('\n')
      ),
      postcode: checkString(record.post_code),
      source: Systems.ACADEMY_BENEFITS
    };
  });
};

let processCustomer = function(record) {
  return {
    systemIds: {
      academyBenefits: [record.claim_id.toString()]
    },
    name: [
      {
        first: nameCase(record.forename),
        last: nameCase(record.surname),
        title: nameCase(record.title)
      }
    ],
    dob: [record.birth_date],
    address: [
      formatAddress(
        [
          record.addr1.trim(),
          record.addr2.trim(),
          record.addr3.trim(),
          record.addr4.trim(),
          record.post_code.trim()
        ]
          .filter(x => x !== '')
          .join('\n')
      )
    ],
    nino: [checkString(record.nino)],
    postcode: [checkString(record.post_code)],
    benefits: {}
  };
};

let processHousehold = function(household){
  return household.map(mem => {
    return {title: nameCase(mem.title), first: nameCase(mem.first), last: nameCase(mem.last), dob: mem.dob}
  })
}

let Backend = {
  customerSearch: async function(query) {
    const results = await runSearchQuery(query);
    return processSearchResults(results);
  },

  fetchCustomer: async function(id) {
    const results = await runFetchQuery(id);
    let customer = processCustomer(results.recordset[0]);
    let benefitsResults = await fetchBenefits(id);
    customer.benefits.income = benefitsResults.recordset;
    let household = await fetchHousehold(id);
    if(household.recordset.length > 0) customer.household = [processHousehold(household.recordset)];
    return customer;
  },

  fetchCustomerNotes: async function() {
    return Promise.resolve([]);
  },

  fetchCustomerDocuments: function() {
    return Promise.resolve([]);
  }
};

module.exports = Backend;