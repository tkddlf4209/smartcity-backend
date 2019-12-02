var express = require('express');
var mysql = require('mysql');
var router = express.Router();

// Connection 객체 생성 
var con = mysql.createConnection({
    host: '118.131.116.84',
    port: 33306,
    user: 'smartcity',
    password: '*smartcity*',
    database: 'smartcity'
});
// Connect
con.connect(function (err) {
    if (err) {
        console.error('mysql connection error');
        console.error(err);
        throw err;
    }
});

/* GET users listing. */
router.get('/test', function (req, res, next) {
    res.send('respond with a resource'+req.params.id);
});

/* GET users listing. */
router.get('/:id', function (req, res, next) {
    res.send('respond with a resource ++ '+ req.params.id);
});


/* GET users listing. */
router.get('/list/:id', function (req, res, next) {
    con.query('SELECT * FROM smartcity.base_bike_info', function (err, rows) {
        if (err) throw err;
        res.send(rows);
    });
});


// insert
/* router.post('/regist', function (req, res) {
    var user = {
        'userid': req.body.userid,
        'name': req.body.name,
        'address': req.body.address
    };
    var query = connection.query('insert into users set ?', user, function (err, result) {
        if (err) {
            console.error(err);
            throw err;
        }
        res.status(200).send('success');
    });
}); */

module.exports = router;
