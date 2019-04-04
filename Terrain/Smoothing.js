/*
 *  Terrain Smooth Engine for Open Fodder (JavaScript version)
 *    Version 0.50
 *    Written by starwindz
 *    Special thanks to segra and drnovice
 *  ------------------------------------------------------------------
 *
 *  Copyright (C) 2019 Open Fodder
 *
 *  This program is free software; you can redistribute it and/or modify
 *  it under the terms of the GNU General Public License as published by
 *  the Free Software Foundation; either version 3 of the License, or
 *  (at your option) any later version.
 *
 *  This program is distributed in the hope that it will be useful,
 *  but WITHOUT ANY WARRANTY; without even the implied warranty of
 *  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 *  GNU General Public License for more details.
 *
 *  You should have received a copy of the GNU General Public License along
 *  with this program; if not, write to the Free Software Foundation, Inc.,
 *  51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA.
 *
 */

//const programMode = 'debug';
const programMode = 'release';

var bm_pre_smooth = {
  "compo": [
    // < I >
    //  000
    //  010
    //  111
    {"flag":"false", "dir":"8", "bitmask": [ {"bm":"00000111"}, {"bm":"00101001"}, {"bm":"11100000"}, {"bm":"10010100"} ] },
    {"flag":"true",  "dir":"8", "bitmask": [ {"bm":"11111000"}, {"bm":"11010110"}, {"bm":"00011111"}, {"bm":"01101011"} ] },
       
    // < II >
    //  100
    //  100
    //  111
    //  ---
    //  111
    //  100
    //  100
    {"flag":"true",  "dir":"8", "bitmask": [ {"bm":"10010111"}, {"bm":"11110100"}, {"bm":"11101001"}, {"bm":"00101111"}, {"bm":"11110100"}, {"bm":"11101001"}, {"bm":"00101111"}, {"bm":"10010111"} ] },
   
    // < III >
    //  000
    //  011
    //  001
    {"flag":"false", "dir":"8", "bitmask": [ {"bm":"00001001"}, {"bm":"00000110"}, {"bm":"10010000"}, {"bm":"01100000"} ] },
    {"flag":"true",  "dir":"8", "bitmask": [ {"bm":"11110110"}, {"bm":"11111001"}, {"bm":"01101111"}, {"bm":"10011111"} ] },
       
    // < IV >
    //  001
    //  011
    //  000    
    {"flag":"false", "dir":"8", "bitmask": [ {"bm":"00101000"}, {"bm":"00000011"}, {"bm":"00010100"}, {"bm":"11000000"} ] },
    //  110
    //  100
    //  111   
    {"flag":"true", "dir":"8", "bitmask": [ {"bm":"11010111"}, {"bm":"11111100"}, {"bm":"11101011"}, {"bm":"00111111"} ] },
       
    // < V >
    //  -1-
    //  101
    //  -1-
    //{"flag":"true",  "dir":"2", "bitmask": [ {"bm":"11"}, {"bm":"11"} ] },
    //  -0-
    //  010
    //  -0-   
    //{"flag":"false", "dir":"2", "bitmask": [ {"bm":"00"}, {"bm":"00"} ] },
       
    // < VI-1 >
    //  001  001  100  110
    //  001  100  000  000
    //  100  100  011  001
    {"flag":"true",  "dir":"8", "bitmask": [ {"bm":"00101100"}, {"bm":"00110100"}, {"bm":"10000011"}, {"bm":"11000001"} ] },
         
    // < VI-2 >
    //  100  100  001  011
    //  100  001  000  000
    //  001  001  110  100
    {"flag":"true",  "dir":"8", "bitmask": [ {"bm":"10010001"}, {"bm":"10001001"}, {"bm":"00100110"}, {"bm":"01100100"} ] },
   
    // < VI-3 >
    //  000  100  011  010
    //  001  100  100  001
    //  110  010  000  001
    {"flag":"true",  "dir":"8", "bitmask": [ {"bm":"00001110"}, {"bm":"10010010"}, {"bm":"01110000"}, {"bm":"01001001"} ] },
   
    // < VI-4 >
    //  000  001  110  010
    //  100  001  001  100
    //  011  010  000  100    
    {"flag":"true",  "dir":"8", "bitmask": [ {"bm":"00010011"}, {"bm":"00101010"}, {"bm":"11001000"}, {"bm":"01010100"} ] },
       
    // < VII >
    //  100  011  110  001
    //  100  100  001  001
    //  011  100  001  110
    {"flag":"true",  "dir":"8", "bitmask": [ {"bm":"10010011"}, {"bm":"01110100"}, {"bm":"11001001"}, {"bm":"00101110"} ] },
   
    // < VIII >
    //  011  100  110  001
    //  000  101  000  101
    //  110  001  011  100
    {"flag":"true",  "dir":"8", "bitmask": [ {"bm":"01100110"}, {"bm":"10011001"}, {"bm":"11000011"}, {"bm":"00111100"} ] }
  ]
};
   
var bm_cf1_jungle_water_darkgrass = {
  "bitmask": [
    {"bm":"00000011", "tiles": [ {"tile":"380"} ] },
    {"bm":"00000111", "tiles": [ {"tile":"304"}, {"tile":"305"} ] }, 
    {"bm":"00000110", "tiles": [ {"tile":"363"} ] },
    {"bm":"00001001", "tiles": [ {"tile":"242"} ] },
    {"bm":"00010100", "tiles": [ {"tile":"243"} ] },
    {"bm":"00101001", "tiles": [ {"tile":"364"}, {"tile":"384"} ] },
    {"bm":"10010100", "tiles": [ {"tile":"266"}, {"tile":"286"}, {"tile":"306"} ] },
    {"bm":"00101000", "tiles": [ {"tile":"264"} ] },
    {"bm":"10010000", "tiles": [ {"tile":"261"} ] },
    {"bm":"01100000", "tiles": [ {"tile":"382"} ] },
    {"bm":"11100000", "tiles": [ {"tile":"365"}, {"tile":"366"}, {"tile":"386"} ] },
    {"bm":"11000000", "tiles": [ {"tile":"361"} ] },
         
    {"bm":"11110000", "tiles": [ {"tile":"360"} ] },
    {"bm":"11100000", "tiles": [ {"tile":"365"}, {"tile":"366"}, {"tile":"386"} ] }, 
    {"bm":"11101000", "tiles": [ {"tile":"383"} ] },
    {"bm":"11010100", "tiles": [ {"tile":"241"} ] },
    {"bm":"01101001", "tiles": [ {"tile":"244"} ] },
    {"bm":"10010100", "tiles": [ {"tile":"266"}, {"tile":"286"}, {"tile":"306"} ] },
    {"bm":"00101001", "tiles": [ {"tile":"364"}, {"tile":"384"} ] },
    {"bm":"10010110", "tiles": [ {"tile":"263"} ] },
    {"bm":"00101011", "tiles": [ {"tile":"262"} ] },
    {"bm":"00010111", "tiles": [ {"tile":"362"} ] },
    {"bm":"00000111", "tiles": [ {"tile":"304"}, {"tile":"305"} ] },
    {"bm":"00001111", "tiles": [ {"tile":"381"} ] },
         
    {"bm":"00001011", "tiles": [ {"tile":"284"}, {"tile":"285"} ] },
    {"bm":"00010110", "tiles": [ {"tile":"280"}, {"tile":"281"} ] },
    {"bm":"01101000", "tiles": [ {"tile":"282"}, {"tile":"283"} ] },
    {"bm":"11010000", "tiles": [ {"tile":"245"}, {"tile":"265"} ] }
  ]
};
   
var bm_cf1_jungle_lightgrass_darkgrass = {
  "bitmask": [
    {"bm":"00000011", "tiles": [ {"tile":"228"} ] },
    {"bm":"00000111", "tiles": [ {"tile":"127"}, {"tile":"128"} ] }, 
    {"bm":"00000110", "tiles": [ {"tile":"229"} ] },
    {"bm":"00001001", "tiles": [ {"tile":"228"} ] },
    {"bm":"00010100", "tiles": [ {"tile":"229"} ] },
    {"bm":"00101001", "tiles": [ {"tile":"165"}, {"tile":"185"} ] },
    {"bm":"10010100", "tiles": [ {"tile":"49"},  {"tile":"69"} ] },
    {"bm":"00101000", "tiles": [ {"tile":"209"} ] },
    {"bm":"10010000", "tiles": [ {"tile":"210"} ] },
    {"bm":"01100000", "tiles": [ {"tile":"20"} ] },
    {"bm":"11100000", "tiles": [ {"tile":"47"},  {"tile":"48"} ] },
    {"bm":"11000000", "tiles": [ {"tile":"210"} ] },
       
    {"bm":"11110000", "tiles": [ {"tile":"68"} ] },
    {"bm":"11100000", "tiles": [ {"tile":"47"},  {"tile":"48"} ] }, 
    {"bm":"11101000", "tiles": [ {"tile":"67"} ] },
    {"bm":"11010100", "tiles": [ {"tile":"68"} ] },
    {"bm":"01101001", "tiles": [ {"tile":"67"} ] },
    {"bm":"10010100", "tiles": [ {"tile":"49"},  {"tile":"69"} ] },
    {"bm":"00101001", "tiles": [ {"tile":"165"}, {"tile":"185"} ] },
    {"bm":"10010110", "tiles": [ {"tile":"205"} ] },
    {"bm":"00101011", "tiles": [ {"tile":"225"} ] },
    {"bm":"00010111", "tiles": [ {"tile":"205"} ] },
    {"bm":"00000111", "tiles": [ {"tile":"127"}, {"tile":"128"} ] },
    {"bm":"00001111", "tiles": [ {"tile":"225"} ] },
         
    {"bm":"00001011", "tiles": [ {"tile":"225"} ] },
    {"bm":"00010110", "tiles": [ {"tile":"205"} ] },
    {"bm":"01101000", "tiles": [ {"tile":"67"}  ] },
    {"bm":"11010000", "tiles": [ {"tile":"68"}  ] }
  ]
};
     
// Delphi compatible AnsiMatchStr function
function AnsiMatchStr(s, s_list) {
  var flag;

  flag = false;
  for (var i = 0; i <= s_list.length - 1; i++) {
    if (s.includes(s_list[i])) {
	    flag = true;
	    break;
    }
  }
  return flag;
}

// Make 2D Array (x, y : sequence)
function makeArray(_w, _h, val) {
  var w = _h;
  var h = _w;

  var arr = [];
  for (var i = 0; i < h; i++) {
    arr[i] = [];
    for (var j = 0; j < w; j++) {
	    arr[i][j] = val;
    }
  }
  return arr;
}

// Set Array Test
function setArray(arr, x, y, v) {
  arr[x][y] = v;
  return 0;
}

// Define TColor Stucture
function TColor() {
  var r, g, b;
}

// Print Debug info
function printDebug(args) {
  if (programMode == 'debug') {
    console.log(args);
  }
  else {
    print(args);
  }
}

// Define multi levels
function TLevel() {
  var name = ''; // string
  var char = ''; // string
  var limit = 0.0; // double
}

// Define smooth setting
function TSmooth() {
  var char1 = '';
  var char2 = '';
}

function pad(n, width) {
  n = n + '';
  return n.length >= width ? n: new Array(width - n.length + 1).join('0') + n;
}

function pads(n, width) {
  n = n + '';
  return n.length >= width ? n: new Array(width - n.length + 1).join(' ') + n;
}

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

// Delphi to JavaScript Syntax Conversion Test
function CTest() {
  this.testDummy = function() {
    printDebug('dummy');
  }

  this.testJavaScriptSyntax = function() {
    // AnsiMatchStr Test
    var s = '*';
    var b = new Array(2);
    b[0] = '+';
    b[1] = '*';
    var flag = s.includes('+');
    printDebug('AnsiMatchStr(*, [+, *]) = ' + AnsiMatchStr(s, b));
  
    // 2D Array Test
    var x = makeArray(10, 100, 0);
    var xx = x[9][99] = 234;
    x[2][3] = 789;
    setArray(x, 2, 3, 789)
    printDebug('x[9][99] = ' + String(xx));
    printDebug('x[2][3] = ' + String(x[2][3]));
  
    // Structure Test
    var c1 = new TColor();
    c1.r = 10;
    c1.g = 20;
    c1.b = 30;
    printDebug('c1.r = ' + String(c1.r));
  
    // Structure Test (2)
    var lev = new TLevel();
    lev.name = 'name1';
    printDebug(lev.name);
  
    // Structure Array Test
    var lev_arr = new Array(1);
    lev_arr[0] = new TLevel();
    lev_arr[0].name = 'name1arr';
    printDebug(lev_arr[0].name);
  
    // Delphi String Copy Function (Warning! Starting index is 0)
    var ss = 'abcde';
    var ss2 = ss.charAt(2);
    printDebug('.charAt(2) = ' + ss2);
  }

}

// CSmoothTerrain
function CSmoothTerrain() {
  var game_type;
  var tile_type;
  var map_col_num, map_row_num;
  var level_num, smooth_num;
  var level, smooth;
  var map_level, map_char, map_tile;
  var s_step;
  var b_list, w_list;
  var _limit_recursion_depth;
  var _max_recursion_depth;
  var _recursion_depth;
  var _chk_tile;

  // Show Map Char for Debugging
  function showMapChar() {
    var s;

    printDebug('');
    for (var j = 0; j <= map_row_num - 1; j++) {
      s = '';
      for (var i = 0; i <= map_col_num - 1; i++) {
        s = s + map_char[i][j];
      }
      printDebug(s);
    }
  }

  function showMapTile() {
    var s;

    printDebug('');
    for (var j = 0; j <= map_row_num - 1; j++) {
      s = '';
      for (var i = 0; i <= map_col_num - 1; i++) {
        s = s + pad(map_tile[i][j], 3) + ' ';
      }
      printDebug(s);
    }

  }

  // Create Map Char according to the level[].limit
  function createMapChar() {
    var i, j, k;
    var _range = new Array(level_num + 1);

    _range[0] = 0;
    for (k = 0; k <= level_num - 1; k++) {
      _range[k + 1] = level[k].limit;
    }

    //printDebug(map_col_num);
    for (i = 0; i <= map_col_num - 1; i++) {
      for (j = 0; j <= map_row_num - 1; j++) {
        for (k = 0; k <= level_num - 1; k++) {

          if ((map_level[i][j] >= _range[k]) &&
            (map_level[i][j] < _range[k + 1])) {
            map_char[i][j] = level[k].char;
            break;
          }

        }
      }
    }

    //printDebug(map_char);
    //printDebug("AAA");
    //showMapChar();
  }

  function get_bitmask_data(i, j) {
    var b;

    if ( (s_step != 0) && (s_step != smooth_num - 1) ) {
      b_list = new Array(3);
      w_list = new Array(2);
    } else {
      b_list = new Array(2);
      w_list = new Array(1);
    }
    b_list[0] = smooth[s_step].char1;
    b_list[1] = smooth[s_step].char2;
    w_list[0] = smooth[s_step].char1;

    if ( (s_step != 0) && (s_step != smooth_num - 1) ) {
      b_list[2] = smooth[s_step + 1].char1;
      w_list[1] = smooth[s_step + 1].char1;
    }
    //printDebug(i, j, w_list);

    // check boundary chars
    // -1 row
    _chk_tile = 0;
    if ((i - 1) < 0 || (j - 1) < 0) {} else {
      if (AnsiMatchStr(map_char[i - 1][j - 1], b_list) == false) {
        _chk_tile++;
      }
    }

    if ((j - 1) < 0) {} else {
      if (AnsiMatchStr(map_char[i][j - 1], b_list) == false) {
        _chk_tile++;
      }
    }

    if ((i + 1) > (map_col_num - 1) || (j - 1) < 0) {} else {
      if (AnsiMatchStr(map_char[i + 1][j - 1], b_list) == false) {
        _chk_tile++;
      }
    }


    // +0 row
    if ((i - 1) < 0) {} else {
      if (AnsiMatchStr(map_char[i - 1][j], b_list) == false) {
        _chk_tile++;
      }
    }

    if ((i + 1) > (map_col_num - 1)) {} else {
      if (AnsiMatchStr(map_char[i + 1][j], b_list) == false) {
        _chk_tile++;
      }
    }

    // +1 row
    if ((i - 1) < 0 || (j + 1) > (map_row_num - 1)) {} else {
      if (AnsiMatchStr(map_char[i - 1][j + 1], b_list) == false) {
        _chk_tile++;
      }
    }

    if ((j + 1) > (map_row_num - 1)) {} else {
      if (AnsiMatchStr(map_char[i][j + 1], b_list) == false) {
        _chk_tile++;
      }
    }

    if ((i + 1) > (map_col_num - 1) || (j + 1) > (map_row_num - 1)) {} else {
      if (AnsiMatchStr(map_char[i + 1][j + 1], b_list) == false) {
        _chk_tile++;
      }
    }

    if (_chk_tile != 0) {
      //printDebug('*** bitmask return ***');
      return '-1'
    }

    // get actual bitmask data
    //  (-1, -1) ( 0, -1) (+1, -1)
    //  (-1,  0)          (+1,  0)
    //  (+1, -1) (+1, -1) (+1, +1)
    b = '';
    // -1 row
    if ((i - 1) < 0 || (j - 1) < 0) {
      b = b + '0';
    } else {
      if (AnsiMatchStr(map_char[i - 1][j - 1], w_list)) {
        b = b + '0';
      } else {
        b = b + '1';
      }
    }

    if ((j - 1) < 0) {
      b = b + '0';
    } else {
      if (AnsiMatchStr(map_char[i][j - 1], w_list)) {
        b = b + '0';
      } else {
        b = b + '1';
      }
    }

    if ((i + 1) > (map_col_num - 1) || (j - 1) < 0) {
      b = b + '0';
    } else {
      if (AnsiMatchStr(map_char[i + 1][j - 1], w_list)) {
        b = b + '0';
      } else {
        b = b + '1';
      }
    }

    // +0 row
    if ((i - 1) < 0) {
      b = b + '0';
    } else {
      if (AnsiMatchStr(map_char[i - 1][j], w_list)) {
        b = b + '0';
      } else {
        b = b + '1';
      }
    }

    if ((i + 1) > (map_col_num - 1)) {
      b = b + '0';
    } else {
      if (AnsiMatchStr(map_char[i + 1][j], w_list)) {
        b = b + '0';
      } else {
        b = b + '1';
      }
    }

    // +1 row
    if ((i - 1) < 0 || (j + 1) > (map_row_num - 1)) {
      b = b + '0';
    } else {
      if (AnsiMatchStr(map_char[i - 1][j + 1], w_list)) {
        b = b + '0';
      } else {
        b = b + '1';
      }
    }

    if ((j + 1) > (map_row_num - 1)) {
      b = b + '0';
    } else {
      if (AnsiMatchStr(map_char[i][j + 1], w_list)) {
        b = b + '0';
      } else {
        b = b + '1';
      }
    }

    if ((i + 1) > (map_col_num - 1) || (j + 1) > (map_row_num - 1)) {
      b = b + '0';
    } else {
      if (AnsiMatchStr(map_char[i + 1][j + 1], w_list)) {
        b = b + '0';
      } else {
        b = b + '1';
      }
    }
    return b;
  }

  function smooth_map_char_step_sub(i, j) {
    var bm;
    var _bm = new Array(4);
    var _bm_ud = '', _bm_lr = '';
    var found_cnt = 0;
    var _comp_char = '';
    var _comp_false = false;
    var _comp_true = true;
    var _WC, _LC;

    _WC = smooth[s_step].char1;
    _LC = smooth[s_step].char2;

    bm = get_bitmask_data(i, j);
    //printDebug(i, j, bm);

    if (_chk_tile != 0) {
      return false;
    }

    _bm[0] = bm.charAt(1, 1);
    _bm[1] = bm.charAt(3, 1);
    _bm[2] = bm.charAt(4, 1);
    _bm[3] = bm.charAt(6, 1);
    _bm_ud = _bm[0] + _bm[3];
    _bm_lr = _bm[1] + _bm[2];

    found_cnt = 0;

    var _psm = bm_pre_smooth;
    var _flag;
    var _bma;
    var _k;
    var _kk;

    //printDebug(b_list);

    for (var _k = 0; _k <= _psm.compo.length - 1; _k++) {
      _bma = new Array(_psm.compo[_k].bitmask.length);

      for (_kk = 0; _kk <= _psm.compo[_k].bitmask.length - 1; _kk++) {
        _bma[_kk] = _psm.compo[_k].bitmask[_kk].bm;
      }

      if (_psm.compo[_k].dir == '8') {

        if (AnsiMatchStr(map_char[i][j], w_list) == false) {
          //printDebug(_k, i, j, 'w_list detected');
          if (_psm.compo[_k].flag == 'false') {
            //printDebug('--->', _k, 'flag detected', bm, _bma);
            if (AnsiMatchStr(bm, _bma) == true) {
              map_char[i][j] = _WC;
              found_cnt++;
              //printDebug('A' + ' ' + _k + ' false' + ' '  + i + ' ' + j + ' changed to ' + _WC);
			  //break;
            }
          }
        }
        if (AnsiMatchStr(map_char[i][j], w_list) == true) {
          if (_psm.compo[_k].flag == 'true') {
            if (AnsiMatchStr(bm, _bma) == true) {
              map_char[i][j] = _LC;
              found_cnt++;
              //printDebug('B' + ' ' + _k + ' true' + ' '  + i + ' ' + j + ' changed to ' + _LC);
			  //break;
            }
          }
        }

      }

      if (_psm.compo[_k].dir == '2') {

        if (AnsiMatchStr(map_char[i][j], w_list) == false) {
          if (_psm.compo[_k].flag == 'false') {
            if ((_bm_ud == _bma[0]) || (_bm_lr == _bma[1])) {
              map_char[i][j] = _WC;
              found_cnt++;
              //printDebug('C', _k, 'false', i, j, 'changed to', _WC);
              //printDebug('C' + ' ' + _k + ' false' + ' '  + i + ' ' + j + ' changed to ' + _WC);
			  //break;
            }
          }
        }
        if (AnsiMatchStr(map_char[i][j], w_list) == true) {
          if (_psm.compo[_k].flag == 'true') {
            if ((_bm_ud == _bma[0]) || (_bm_lr == _bma[1])) {
              map_char[i][j] = _LC;
              found_cnt++;
              //printDebug('D' + ' ' + _k + ' true' + ' '  + i + ' ' + j + ' changed to ' + _LC);
			  //break;
            }
          }
        }

      }

    }


    // check for exiting
    if (found_cnt == 0) {
      return false;
    }

    //return true;
    // recursion started
    if ((i - 1 >= 0) && (j - 1 >= 0)) {
      _recursion_depth++;
      if (_recursion_depth > _limit_recursion_depth) {
        return false;
      }
      smooth_map_char_step_sub(i - 1, j - 1);
    }

    if (j - 1 >= 0) {
      _recursion_depth++;
      if (_recursion_depth > _limit_recursion_depth) {
        return false;
      }
      smooth_map_char_step_sub(i, j - 1);
    }

    if ((i + 1) <= (map_col_num - 1) && (j - 1) >= 0) {
      _recursion_depth++;
      if (_recursion_depth > _limit_recursion_depth) {
        return false;
      }
      smooth_map_char_step_sub(i + 1, j - 1);
    }

    if (i - 1 >= 0) {
      _recursion_depth++;
      if (_recursion_depth > _limit_recursion_depth) {
        return false;
      }
      smooth_map_char_step_sub(i - 1, j);
    }

    if ((i + 1) <= (map_col_num - 1)) {
      _recursion_depth++;
      if (_recursion_depth > _limit_recursion_depth) {
        return false;
      }
      smooth_map_char_step_sub(i + 1, j);
    }

    if ((i - 1 >= 0) && (j + 1) <= (map_row_num - 1)) {
      _recursion_depth++;
      if (_recursion_depth > _limit_recursion_depth) {
        return false;
      }
      smooth_map_char_step_sub(i - 1, j + 1);
    }

    if ((j + 1) <= (map_row_num - 1)) {
      _recursion_depth++;
      if (_recursion_depth > _limit_recursion_depth) {
        return false;
      }
      smooth_map_char_step_sub(i, j + 1);
    }

    if ((i + 1) <= (map_col_num - 1) && (j + 1) <= (map_row_num - 1)) {
      _recursion_depth++;
      if (_recursion_depth > _limit_recursion_depth) {
        return false;
      }
      smooth_map_char_step_sub(i + 1, j + 1);
    }

  }

  function smooth_map_char_step() {
    var i, j;

    _limit_recursion_depth = 96;
    _max_recursion_depth = -1;

    for (j = 0; j <= map_row_num - 1; j++) {
      for (i = 0; i <= map_col_num - 1; i++) {
        //if ( (map_char[i][j] == smooth[s_step].char1) ) {
          _recursion_depth = 0;
          smooth_map_char_step_sub(i, j);
          if (_recursion_depth > _max_recursion_depth) {
            _max_recursion_depth = _recursion_depth;
          }
        //}
      }
    }

  }

  function smoothMapChar() {
    var i, m, st, ed;

    st = 0;
    ed = smooth_num - 1;
    //ed = 1;
    for (m = st; m <= ed; m++) {
      s_step = m;
      smooth_map_char_step();
	  printDebug('>> Smooth map char... Step ' + m);
    }
    //showMapChar();
  }

  function smoothWaterAndLandEach(_bms) {
    var i, j, k, _kk;
    var bm;
    var found = false;
    var cnt;
    var _bma;
    var _WC, _LC;
    var _tmp_tile;

    _WC = smooth[s_step].char1;
    _LC = smooth[s_step].char2;
    //printDebug('WC = ', s_step, _WC);

    /// all adjacent cells should be _WC or _LC. if not returns '-1' (skip processing)
    //printDebug('start bitmasking...');
    cnt = 0;
    for (j = 0; j <= map_row_num - 1; j++) {
      for (i = 0; i <= map_col_num - 1; i++) {
        //printDebug(map_char[i][j]);
        if (map_char[i][j] == _WC) {
          bm = get_bitmask_data(i, j);
          //printDebug(i, j, bm);

          if (_chk_tile != 0) {
            //printDebug('.....continue');
            continue;
          }

          found = false;
          for (k = 0; k <= 27; k++) {
            if (_bms.bitmask[k].bm == bm) {
              cnt++;

              _bma = new Array(_bms.bitmask[k].tiles.length);
              for (_kk = 0; _kk <= _bms.bitmask[k].tiles.length - 1; _kk++) {
                _bma[_kk] = _bms.bitmask[k].tiles[_kk].tile;
              }

              _tmp_tile = map_tile[i][j];
              map_tile[i][j] = Number(_bma[getRandomInt(0, _bms.bitmask[k].tiles.length - 1)]);
              //printDebug('>> m = ' + pads(s_step, 2) + ' ' + pads(i, 3) + ',' + pads(j, 3) + ' : ' + pads(_tmp_tile, 3) + ' is bitmasked to ' + map_tile[i][j]);
              break;
            }
          }

        }
      }
    }

  }

  function smoothWaterAndLand() {
    var i, j, m;

    if ( (game_type == 'cf1') && (tile_type == 'jungle') ) {
      // for cf1-jungle
      var _water =      [326, 346];
      var _darkgrass =  [123, 124];
      var _lightgrass = [0, 20, 40];
      var _darkgrass2 = [123, 124];
      var _tree =       [1, 2];
      var _bms;

      //printDebug('>> smoothWaterAndLand: started');

      // init
      for (j = 0; j <= map_row_num - 1; j++) {
        for (i = 0; i <= map_col_num - 1; i++) {

          if (map_char[i][j] == level[0].char) {
            map_tile[i][j] = _water[getRandomInt(0, _water.length - 1)];
          } else if (map_char[i][j] == level[1].char) {
            map_tile[i][j] = _darkgrass[getRandomInt(0, _darkgrass.length - 1)];
          } else if (map_char[i][j] == level[2].char) {
            map_tile[i][j] = _lightgrass[getRandomInt(0, _lightgrass.length - 1)];
          } else if (map_char[i][j] == level[3].char) {
            map_tile[i][j] = _darkgrass2[getRandomInt(0, _darkgrass2.length - 1)];
          } else if (map_char[i][j] == level[4].char) {
            map_tile[i][j] = _tree[getRandomInt(0, _tree.length - 1)];
          }

        }
      }

      //printDebug('---');
      //showMapTile();

      for (m = 0; m <= 1; m++) {
        if (m == 0) {
          _bms = bm_cf1_jungle_water_darkgrass;
        } else if (m == 1) {
          _bms = bm_cf1_jungle_lightgrass_darkgrass;
        }
        s_step = m;
        smoothWaterAndLandEach(_bms);
	    printDebug('>> Smooth water and land... Step ' + m);
      }

      //printDebug('---');
      //showMapTile();
    }

  }

  function normaizeMapLevel() {
    var min, max, divisor;
    var i, j;
  
    min = 0;
    max = 0;
  
    for (i = 0; i <= map_col_num - 1; i++) {
      for (j = 0; j <= map_row_num - 1; j++) {
        if (map_level[i][j] < min) {
          min = map_level[i][j];
        }
        else if (map_level[i][j] > max) {
          max = map_level[i][j];
        }
      }
    }
  
    divisor = max - min;
    printDebug('min = ' + min);
    printDebug('max = ' + max);
    printDebug('divisor = ' + divisor);
  
    for (i = 0; i <= map_col_num - 1; i++) {
      for (j = 0; j <= map_row_num - 1; j++) {
        map_level[i][j] = ( map_level[i, j] - min ) / divisor;
      }
    }
  }

  this.convertMapChar = function(_map_char) {
    var w, h;
  
    w = _map_char[0].length;
    h = _map_char.length;
    var map_char = makeArray(w, h, '#');
    for (j = 0; j <= h - 1; j++) {
      for (i = 0; i <= w - 1; i++) {
        map_char[i][j] = _map_char[j].charAt(i);
      }
    }
    return map_char;
  }
  
  this.getMapTile = function(i, j) {
	  return map_tile[i][j];
  }
  
  // Set up
  this.run = function(_game_type, _tile_type, _mode, _w, _h, _map, _limits) {
    var i, j;

    printDebug('>> SmoothEngine started');

    // Set Map Cols and Rows
    map_col_num = _w;
    map_row_num = _h;

    // Transfer raw map_levels data
    game_type = _game_type;
    tile_type = _tile_type;

    map_char = makeArray(_w, _h, '');
    if (_mode == 'level') {
      map_level = makeArray(_w, _h, 0);
      for (i = 0; i <= _w - 1; i++) {
        for (j = 0; j <= _h - 1; j++) {
          map_level[i][j] = _map[i][j];
        }
      }
      //normaizeMapLevel();
    }
    else if (_mode == 'char') {
      for (i = 0; i <= _w - 1; i++) {
        for (j = 0; j <= _h - 1; j++) {
          map_char[i][j] = _map[i][j];
        }
      }
    }
    map_tile = makeArray(_w, _h, 0);

    if ( (game_type == 'cf1') && (tile_type == 'jungle') ) {
      level_num = _limits.length;
      smooth_num = 3;

      level = new Array(level_num);
      smooth = new Array(smooth_num);
      for (i = 0; i <= level_num - 1; i++) {
        level[i] = new TLevel();
      }
      for (i = 0; i <= smooth_num - 1; i++) {
        smooth[i] = new TSmooth();
      }

      level[0].name = 'water';      level[0].char = '.';
      level[1].name = 'darkgrass';  level[1].char = '#';
      level[2].name = 'lightgrass'; level[2].char = '+';
      level[3].name = 'darkgrass';  level[3].char = '#';
      level[4].name = 'tree';       level[4].char = 'T';
      for (i = 0; i <= level_num - 1; i++) {
        level[i].limit = _limits[i];
      }

      smooth[0].char1 = '.'; smooth[0].char2 = '#';
      smooth[1].char1 = '+'; smooth[1].char2 = '#';
      smooth[2].char1 = 'T'; smooth[2].char2 = '#';

      //printDebug('jungle init ok');
    }
    //printDebug('init ok');

    if (_mode == 'level') {    
      createMapChar();
    }
    //showMapChar();

	  printDebug('>> Smooth map char... Started');
    smoothMapChar();
    //showMapChar();

	  printDebug('>> Smooth water and land... Started');
    smoothWaterAndLand();

    return map_tile;
  }

}

/*
var t = new CTest();
t.testDummy();
t.testJavaScriptSyntax();
printDebug('-dummy test done-');
printDebug('');
*/

// CSmoothTerrain Test
// -- 'level' mode test
// -- Set Test Vars
/*
var w = 16;
var h = 16;
var i, j;

// -- Set array generated from simplex map
var map_lev = makeArray(w, h, 0.0);
// -- Make test levels
for (i = 0; i <= w - 1; i++) {
  for (j = 0; j <= h - 1; j++) {
    map_lev[i][j] = 0.2;
  }
}
for (i = 0; i <= w - 1; i++) {
  map_lev[i][0] = 0.0;
  map_lev[i][1] = 0.0;
  map_lev[i][h - 2] = 0.0;
  map_lev[i][h - 1] = 0.0;
}
for (j = 0; j <= h - 1; j++) {
  map_lev[0][j] = 0.0;
  map_lev[1][j] = 0.0;
  map_lev[w - 2][j] = 0.0;
  map_lev[w - 1][j] = 0.0;
}
map_lev[8][1] = 0.4;
map_lev[5][2] = 0.0;
map_lev[1][5] = 0.4;
map_lev[5][h-2] = 0.4;
map_lev[w - 3][10] = 0.1;

// -- Set level limits
var lev_limits = [0.17, 0.25, 0.35, 0.45, 1.00];
var st = new CSmoothTerrain();
var map = st.run('cf1', 'jungle', 'level', w, h, map_lev, lev_limits);
*/

// -- 'char' mode test
/*
var _map_char = [
  '....................',
  '....................',
  '.........#..........',
  '..##.#############..',
  '..################..',
  '..##++++++++++++##..',
  '..##+++++#++++++##..',
  '..##++######+#++##..',
  '..##++########++##..',
  '..##++##TTTT##++##..',
  '..##+###TTTT##++##..',
  '..##++##TTTT##++##..',
  '..##++##TTTT##++##..',
  '..##++########++##..',
  '..##++########++##..',
  '..##++++++++++++##..',
  '..##++++++++++++##..',
  '..#######+########..',
  '..################..',
  '....................',
  '....................'
];
*/

/*
var _map_char = [
  '....................',
  '....................',
  '.........#..........',
  '..##########.#####..',
  '..################..',
  '..###++++++++++###..',
  '..##++++++++++++##..',
  '..##++########++##..',
  '..##++########++##..',
  '..##++###TT###++##..',
  '..##++##TTTT##++##..',
  '..##++##TTTT##++##..',
  '..##++###TT###++##..',
  '..##++########++##..',
  '..##++########++##..',
  '..##++++++++++++##..',
  '..###++++++++++###..',
  '..################..',
  '..################..',
  '....................',
  '....................'
];
*/

/*
var _map_char = [
  '....................',
  '....................',
  '.........#..........',
  '..##########.#####..',
  '..################..',
  '..################..',
  '..###+++++++++####..',
  '..###++++++++++###..',
  '..###++++++++++###..',
  '..###++++++++++###..',
  '..###++++++++++###..',
  '..###++++++++++###..',
  '..###++++++++++###..',
  '..###++++++++++###..',
  '..####++++++++####..',
  '..################..',
  '..################..',
  '..################..',
  '....................',
  '....................'
];
*/

/*
var _map_char = [
  '....................',
  '....................',
  '.........#..........',
  '..##########.#####..',
  '..################..',
  '..################..',
  '..###++++++++++###..',
  '.####++++++++++###..',
  '..###++++++++++##...',
  '..###++++++++++###..',
  '..###++++++++++###..',
  '...##++++++++++###..',
  '..###++++++++++###..',
  '..###++++++++++####.',
  '..###++++++++++###..',
  '..################..',
  '..################..',
  '..##########.#####..',
  '......#.............',
  '....................'
];
*/

/*
var _map_char = [
  '....................',
  '....................',
  '.........#..........',
  '..##########.#####..',
  '..################..',
  '..###++++++++++###..',
  '..###++++++++++###..',
  '..###++######++###..',
  '..###++######++###..',
  '..###++######++###..',
  '..###++######++###..',
  '..###++######++###..',
  '..###++######++###..',
  '..###++######++###..',
  '..###++######++###..',
  '..###++######++###..',
  '..###++######++###..',
  '..###++++++++++###..',
  '..###++++++++++###..',
  '..################..',
  '..################..',
  '..##########.#####..',
  '......#.............',
  '....................'
];
*/

/*
var _map_char = [
  '..........................',
  '..........................',
  '..######################..',
  '..######################..',
  '..######################..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..######################..',
  '..######################..',
  '..........................',
  '..........................',
];
*/

/*
var _map_char = [
  '..........................',
  '..........................',
  '..######################..',
  '..######################..',
  '..######################..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++############++###..',
  '..###++############++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++############++###..',
  '..###++############++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..######################..',
  '..######################..',
  '..........................',
  '..........................',
];
*/

if (programMode == 'debug') {

var _map_char = [
  '..........................',
  '..........................',
  '..######################..',
  '..######################..',
  '..###++++####++++++++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..###++############++###..',
  '..###++#####TTT####++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++##TTTTTTTT##++###..',
  '..###++############++###..',
  '..###++############++###..',
  '..###++++++++++++++++###..',
  '..###++++++++++++++++###..',
  '..######################..',
  '..######################..',
  '..........................',
  '..........................',
];

var st = new CSmoothTerrain();
var map_char = st.convertMapChar(_map_char);
var w = _map_char[0].length;
var h = _map_char.length;
var lev_limits = [0, 0, 0, 0, 0];
var map = st.run('cf1', 'jungle', 'char', w, h, map_char, lev_limits);

}