var app = app || angular.module('app', []);

app.controller("AvrSimController", function($scope) {
	$scope.do_nothing = function(a) {}
	$scope.debug_log = $scope.do_nothing;
	$scope.status = "Ready";
	$scope.running = false;
	$scope.outputs = [];
	$scope.io_state = {
		'switch_state': ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"]
	};
	$scope.steps = {
		'count': 1
	};
	$scope.output_type = {
		"selection": "program"
	};
	$scope.cm_setup = function() {
		var sim_textarea = document.getElementById("simavr" + $scope.simid + "_program_area");
		$scope.debug_log($scope.simid, sim_textarea);
		if (sim_textarea == null) return;
		$scope.editor = CodeMirror.fromTextArea(sim_textarea, {
			lineNumbers: true,
			gutters: ["breakpoints", "CodeMirror-linenumbers"]
		});
		if ($scope.size) {
			if ($scope.size == "auto") {
				$scope.editor.setSize(null, ($scope.program.split("\n").length + 2) * ($scope.editor.defaultTextHeight()) + 10);
			} else {
				$scope.editor.setSize(null, $scope.size);
			}
		} else {
			$scope.editor.setSize(null, "70%");
		}
		$scope.editor.setOption("extraKeys", {
			'Ctrl-Enter': function(cm) {
				$scope.program_pm();
				$scope.$apply();
			}
		});
		$scope.editor.setValue($scope.program);
	}
	$scope.symbols = {};
	$scope.PM_display_mode = "t";
	$scope.RAM_display_mode = "d";
	$scope.RF_display_mode = "d";
	$scope.RAM = [];
	$scope.PM = [];
	$scope.RF = [];

	$scope.PIND = 0;
	$scope.PORTD = 0;
	$scope.DDRD = 0;
	$scope.SPH = 0;
	$scope.SPL = 0;

	$scope.RAM_size = 65536;
	$scope.PM_size = 65536;
	$scope.RF_size = 32;
	$scope.updated = [];
	$scope.error_line = 0;
	$scope.current_ram_data = [];
	$scope.reset_program = function() {
		if ($scope.running) return;
		if ($scope.text) {
			$scope.debug_log("Using text");
			$scope.program = $scope.text;
		} else if ($scope.original_program) {
			$scope.program = $scope.original_program;
		}
		$scope.change_program($scope.program);
	}

	$scope.reset = function(pm_reset) {
		$scope.io_state.switch_state = ["OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF", "OFF"];
		$scope.output_type.selection = "program";
		$scope.display_pm_start = 0;
		$scope.display_ram_start = 0;
		$scope.steps = {
			'count': 1
		};
		$scope.PC = 0;
		$scope.Z = 0;
		$scope.C = 0;
		$scope.N = 0;
		$scope.PIND = 0;
		$scope.PORTD = 0;
		$scope.DDRD = 0;
		$scope.SPH = 0;
		$scope.SPL = 0;
		$scope.updated = [];
		$scope.ram_updated = [];
		$scope.outputs = [];
		$scope.output_state = "READY";
		$scope.mux = new $scope.output_mux();
		$scope.lcd = new $scope.char_display();
		$scope.output_devs = [];
		$scope.output_devs.push($scope.lcd);
		for (var i = 0; i < $scope.RF_size; i++) $scope.RF[i] = 0;
		for (var i = 0; i < $scope.RAM_size; i++) $scope.RAM[i] = 0;
		for (var i = 0; i < $scope.IORF_size; i++) $scope.IORF[i] = 0;
		var nop = $scope.parse("nop", 0);
		if (pm_reset) {
			for (var i = 0; i < $scope.PM_size; i++) {
				nop.addr = i;
				$scope.PM[i] = nop;
			}
		}
		if (!pm_reset) {
			for (var i = 0; i < $scope.current_ram_data.length; i++) $scope.RAM[i + 1024] = $scope.current_ram_data[i];
		}
		if ($scope.editor) $scope.editor.removeLineClass($scope.error_line, "background", "active_line");
	}
	$scope.display_pm_start = 0;
	$scope.display_ram_start = 0;
	$scope.display_pm_length = 16;
	$scope.display_ram_length = 16;

	$scope.change_program = function(prog) {
		$scope.program = prog;
		if ($scope.editor) $scope.editor.setValue(prog);
	}
	$scope.display_ram = function(i) {
		if ($scope.RAM_display_mode == "d") {
			return $scope.RAM[i];
		} else if ($scope.RAM_display_mode == "2") {
			return $scope.truncate($scope.RAM[i], 8, true);
		} else if ($scope.RAM_display_mode == "c") {
			return String.fromCharCode($scope.RAM[i])
		}
	}
	$scope.display_rf = function(i) {
		if ($scope.RF_display_mode == "d") {
			return $scope.truncate($scope.RF[i], 8, false);
		}
		if ($scope.RF_display_mode == "2") {
			return $scope.truncate($scope.RF[i], 8, true);
		} else if ($scope.RF_display_mode == "b") {
			var s = $scope.RF[i].toString(2);
			return smul("0", 8 - s.length) + s;
		} else if ($scope.RF_display_mode == "h") {
			var s = $scope.RF[i].toString(16);
			return "0x" + smul("0", 2 - s.length) + s;
		}
	}
	$scope.program_pm = function() {
		if ($scope.running) return;
		$scope.reset(true);
		$scope.running = true;
		$scope.program = $scope.editor.getValue();
		var pm_data = $scope.preparse($scope.program);
		if (!pm_data) {
			$scope.running = false;
			return;
		}
		var pm_addr = 0;
		for (var i = 0; i < pm_data.length; i++) {
			var datum = pm_data[i];
			if (datum.inst) {
				var inst = $scope.parse(datum.inst, pm_addr);
				if (!inst) continue;
				if (inst.error) {
					$scope.error_on_line(datum.line, inst.error);
					return;
				}
				$scope.PM[pm_addr] = inst;
				pm_addr++;
			} else if (datum.word) {
				var inst = $scope.decode(datum.word, pm_addr);
				if (inst.error) {
					$scope.error_on_line(datum.line, inst.error);
					return;
				}
				$scope.PM[pm_addr] = inst;
				pm_addr++;
			}
		}
		$scope.status = "Ready";
	}
	$scope.error_on_line = function(linenum, err_msg) {
		$scope.running = false;
		$scope.status = "Error on line " + linenum + ": " + err_msg;
		$scope.error_line = linenum;
		if ($scope.editor) $scope.editor.addLineClass(linenum, "background", "active_line");
	}
	$scope.preparse = function() {
		var lines = $scope.program.split("\n");
		var to_program = [];
		var pm_offset = 0;
		var ram_offset = 1024;
		for (var i = 0; i < lines.length; i++) {
			var pieces = lines[i].match(/^((?:[^";]|';'|"(?:[^\\"]+|\\(?:\\\\)*[nt\\"])*")*)(;.*)?$/)
			$scope.debug_log("P", pieces);
			if (!pieces) {
				$scope.error_on_line(i, "Invalid line: " + i);
				return;
			}
			if (!pieces[1]) continue;
			lines[i] = pieces[1].trim();
			var is_inst = true;
			for (var d in $scope.directives) {
				var matches = lines[i].match($scope.directives[d].regex)
				$scope.debug_log("D", lines[i], d, matches);
				if (matches) {
					// process needs to return:
					// - What it inserts to PM (pm_data)
					// - What it inserts into RAM (ram_data)
					// - What symbol it wants to make (symbol)
					// - What kind of symbol it is (symbol_type == "pm" | "ram")
					// - Whether there was an error (error)

					var result = $scope.directives[d].process(matches);

					// Handle error
					if (result.error) {
						$scope.error_on_line(i, result.error);
						return;
					}

					// Update symbol
					if (result.symbol && result.symbol_type) {
						if (result.symbol_type == "pm") {
							$scope.symbols[result.symbol] = pm_offset;
						} else if (result.symbol_type == "ram") {
							$scope.symbols[result.symbol] = ram_offset;
						}
					}

					// Insert data and update offsets
					if (result.pm_data) {
						for (var j = 0; j < result.pm_data.length; j++) {
							to_program.push({
								'word': result.pm_data[j],
								'line': i
							});
						}
						pm_offset += result.pm_data.length;
					}
					if (result.ram_data) {
						for (var j = 0; j < result.ram_data.length; j++) {
							$scope.RAM[ram_offset + j] = result.ram_data[j];
						}
						$scope.current_ram_data = $scope.current_ram_data.concat(result.ram_data);
						ram_offset += result.ram_data.length;
					}
					is_inst = false;
					break;
				}
			}
			if (is_inst && !(/^[ \t]*$/.test(lines[i]))) {
				to_program.push({
					'inst': lines[i],
					'line': i
				});
				pm_offset++;
			}
		}
		return to_program;
	}
	$scope.parse = function(inst, addr) {
		$scope.debug_log(inst)
		var matches = inst.match(/^[ \t]*([a-zA-Z]+)[ \t]*((?:[^;]|';')*)[ \t]*$/)
		if (!matches) {
			return {
				"error": "Line does not match any directive or instruction"
			};
		}
		var mnemonic = matches[1];
		var operand = matches[2];
		$scope.debug_log(mnemonic, "|||", operand);
		if (mnemonic in $scope.instructions) {
			var format = $scope.instructions[mnemonic].format;
			var execf = $scope.instructions[mnemonic].exec;
			var ops = operand.match($scope.formats[format].string);
			if (!ops) {
				return {
					"error": "Operands to instruction " + inst + " did not parse"
				};
			}
			for (var i = 0; i < 3; i++) {
				if (/^[0-9]+$/.test(ops[i])) ops[i] = parseInt(ops[i]);
				//else if(format.sym_valid[i]) ops[i] = symbols[ops[i]];
			}
			var opcode = $scope.instructions[mnemonic].c;
			$scope.debug_log(format, execf, ops, opcode);
			var data = {
				"r": ops[1],
				"s": ops[2],
				"i": ops[3],
				"c": opcode
			};
			var new_inst = new $scope.instruction(mnemonic + " " + operand, mnemonic, data, execf, addr);
			if (new_inst.error) {
				return {
					"error": inst.error
				};
			}
			if (new_inst.check_valid()) {
				return new_inst;
			} else {
				return {
					"error": "Illegal operands to instruction " + inst
				};
			}
		} else {
			return {
				"error": "Invalid instruction " + inst
			};
		}
		return null;
	}
	$scope.is_updated = function(x) {
		for (var i = 0; i < $scope.updated.length; i++) {
			if ($scope.updated[i] == x) return true;
		}
		return false;
	}
	$scope.is_ram_updated = function(x) {
		for (var i = 0; i < $scope.updated.length; i++) {
			if ($scope.ram_updated[i] == x) return true;
		}
		return false;
	}
	$scope.handle_string_escapes = function(s) {
		s = s.replace(/(([^\\]|)(\\\\)*)\\t/g, "$1\t");
		s = s.replace(/(([^\\]|)(\\\\)*)\\n/g, "$1\n");
		s = s.replace(/(([^\\]|)(\\\\)*)\\"/g, "$1\"");
		s = s.replace(/\\\\/g, "\\");
		return s;
	}
	$scope.directives = {
		"label": {
			"regex": /^([a-zA-Z_][a-zA-Z0-9_]*):$/,
			"process": function(args) {
				return {
					"symbol": args[1],
					"symbol_type": "pm",
				};
			}
		},
		"word": {
			"regex": /^\.word ([0-9,]+)$/,
			"process": function(args) {
				var rdata = args[1].split(",");
				for (var i = 0; i < rdata.length; i++) {
					rdata[i] = $scope.truncate(parseInt(rdata[i]), 16, false);
				}
				return {
					"symbol": args[1],
					"symbol_type": "pm",
					"pm_data": rdata
				};
			}
		},
		"byte_ram": {
			"regex": /^ *\.byte\(([a-zA-Z_][a-zA-Z0-9_]*)\) ([-0-9, ]+) *$/,
			"process": function(args) {
				var rdata = args[2].split(",");
				for (var i = 0; i < rdata.length; i++) {
					rdata[i] = $scope.truncate(parseInt(rdata[i].trim()), 8, false);
				}
				return {
					"symbol": args[1],
					"symbol_type": "ram",
					"ram_data": rdata
				};
			}
		},
		"string_ram": {
			"regex": /^ *\.string\(([a-zA-Z_][a-zA-Z0-9_]*)\) "((?:[^"\\]|\\.)*)" *$/,
			"process": function(args) {
				var str = $scope.handle_string_escapes(args[2]);
				var rdata = []
				for (var i = 0; i < str.length; i++) {
					rdata.push($scope.truncate(str.charCodeAt(i), 8, false));
				}
				rdata.push(0);
				return {
					"symbol": args[1],
					"symbol_type": "ram",
					"ram_data": rdata
				};

			}
		}
	};
	// X,*:  111
	// Y,"": 010
	// Y,+-" 110
	// Z,"": 000
	// Z,+-: 100
	// "":  00
	// "+": 01
	// "-": 10
	$scope.encode_x = function(i) {
		var x = 0;
		var ptr = i[0] == "-" ? i[1] : i[0];
		var mod = i[0] == "-" ? "-" : (i[1] == "+" ? "+" : "");
		if (ptr == "X") x = 7 * 4
		if (ptr == "Y") x = 6 * 4
		if (ptr == "Z") x = 4 * 4
		if (ptr != "X" && mod == "") x -= 16;
		if (mod == "+") x += 1;
		if (mod == "-") x += 2;
		return x;
	}
	$scope.decode_x = function(x) {
		var ptr = "";
		var mod = "";
		$scope.debug_log("XX", x, x & 3, (x >> 2) & 3)
		if (((x >> 2) & 3) == 3) ptr = "X";
		if (((x >> 2) & 3) == 2) ptr = "Y";
		if (((x >> 2) & 3) == 0) ptr = "Z";
		if ((x & 3) == 1) mod = "+";
		if ((x & 3) == 2) mod = "-";
		$scope.debug_log("X=", mod, ptr)
		return mod == "-" ? mod + "" + ptr : ptr + "" + mod;
	}
	$scope.formats = {
		"4r8i": {
			"string": / *r([0-9]+), *()(-?[a-zA-Z_0-9)(-]+|'..?') *$/,
			"to_string": function(mnemonic, c, r, s, i) {
				return mnemonic + " r" + r + "," + i;
			},
			"binary": "CCCCIIIIRRRRIIII",
			"i_bits": 8,
			"validator": function(c, r, s, i) {
				return 16 <= r && r < 32 && -128 <= i && i < 256;
			}
		},
		"5r5s": {
			"string": / *r([0-9]+), *r([0-9]+)() *$/,
			"to_string": function(mnemonic, c, r, s, i) {
				return mnemonic + " r" + r + ",r" + s;
			},
			"binary": "CCCCCCSRRRRRSSSS",
			"validator": function(c, r, s, i) {
				return 0 <= r && r < 32 && 0 <= s && s < 32;
			}
		},
		"6s5r": {
			"string": / *r([0-9]+), *([0-9]+)() *$/,
			"to_string": function(mnemonic, c, r, s, i) {
				return mnemonic + " r" + r + "," + s;
			},
			"binary": "CCCCCSSRRRRRSSSS",
			"validator": function(c, r, s, i) {
				return 0 <= r && r < 32 && 0 <= s && s < 64;
			}
		},
		"5r6s": {
			"string": / *([0-9]+), *r([0-9]+)() *$/,
			"to_string": function(mnemonic, c, r, s, i) {
				return mnemonic + " " + r + ",r" + s;
			},
			"binary": "CCCCCSSRRRRRSSSS",
			"validator": function(c, r, s, i) {
				return 0 <= r && r < 64 && 0 <= s && s < 32;
			}
		},
		"5r": {
			"string": / *r([0-9]+)()() *$/,
			"to_string": function(mnemonic, c, r, s, i) {
				return mnemonic + " r" + r;
			},
			"binary": "CCCCCCCRRRRRCCCC",
			"validator": function(c, r, s, i) {
				return 0 <= r && r < 32;
			}
		},
		"5rX": {
			"string": / *r([0-9]+)(), *(-[XYZ]|[XYZ]|[XYZ]\+) *$/,
			"to_string": function(mnemonic, c, r, s, i, x) {
				return mnemonic + " r" + r + "," + i
			},
			"binary": "CCCXCCCRRRRRXXXX",
			"validator": function(c, r, s, i) {
				return 0 <= r && r < 32;
			}
		},
		"X5r": {
			"string": / *(-[XYZ]|[XYZ]|[XYZ]\+), *r([0-9]+)() *$/,
			"to_string": function(mnemonic, c, r, s, i, x) {
				return mnemonic + " " + r + ",r" + s;
			},
			"binary": "CCCXCCCRRRRRXXXX",
			"validator": function(c, r, s, i) {
				return 0 <= s && s < 32;
			}
		},
		"12i": {
			"string": / *()()(-?[a-zA-Z_0-9)(]+) *$/,
			"to_string": function(mnemonic, c, r, s, i) {
				return mnemonic + " " + i;
			},
			"binary": "CCCCIIIIIIIIIIII",
			"i_bits": 12,
			"validator": function(c, r, s, i) {
				return -2048 <= i && i < 2048;
			}
		},
		"7i": {
			"string": / *()()(-?[a-zA-Z_0-9)(]+) *$/,
			"to_string": function(mnemonic, c, r, s, i) {
				return mnemonic + " " + i;
			},
			"binary": "CCCCCCIIIIIIICCC",
			"i_bits": 7,
			"validator": function(c, r, s, i) {
				return -64 <= i && i < 64;
			}
		},
		"n": {
			"string": / *()()() *$/,
			"to_string": function(mnemonic, c, r, s, i) {
				return mnemonic;
			},
			"binary": "CCCCCCCCCCCCCCCC",
			"validator": function(c, r, s, i) {
				return true;
			}
		}
	}
	$scope.encode = function(format, c, r, s, i) {
		var fmt = $scope.formats[format].binary;
		var inst = 0;
		var x = 0;
		if (format == "5r6s") {
			i = s;
			s = r;
			r = i;
		} else if (format == "5rX" || format == "X5r") {
			if (format == "X5r") {
				i = r;
				r = s;
			}
			$scope.debug_log("Xe", i);
			x = $scope.encode_x(i);
			$scope.debug_log("Xd", x);
		}
		for (var j = 15; j >= 0; j--) {
			if (fmt[j] == "C") {
				inst += (c % 2) << (15 - j);
				c >>= 1;
			}
			if (fmt[j] == "R") {
				inst += (r % 2) << (15 - j);
				r >>= 1;
			}
			if (fmt[j] == "S") {
				inst += (s % 2) << (15 - j);
				s >>= 1;
			}
			if (fmt[j] == "I") {
				inst += (i % 2) << (15 - j);
				i >>= 1;
			}
			if (fmt[j] == "X") {
				inst += (x % 2) << (15 - j);
				x >>= 1;
			}
		}
		return inst;
	}
	$scope.decode = function(x, addr) {
		for (var f in $scope.formats) {
			fmt = $scope.formats[f];
			var data = {
				"c": 0,
				"r": 0,
				"s": 0,
				"i": 0,
				"x": 0
			}
			for (var j = 15; j >= 0; j--) {
				//$scope.debug_log("J",j,fmt.binary[15-j],(x>>j)%2);
				if (fmt.binary[15 - j] == "C") data.c = (data.c * 2) + ((x >> j) % 2);
				if (fmt.binary[15 - j] == "R") data.r = (data.r * 2) + ((x >> j) % 2);
				if (fmt.binary[15 - j] == "S") data.s = (data.s * 2) + ((x >> j) % 2);
				if (fmt.binary[15 - j] == "I") data.i = (data.i * 2) + ((x >> j) % 2);
				if (fmt.binary[15 - j] == "X") data.x = (data.x * 2) + ((x >> j) % 2);
			}
			if (f == "4r8i") data.r += 16;
			if (f == "12i") data.i = $scope.truncate(data.i, 12, true);
			if (f == "7i") data.i = $scope.truncate(data.i, 7, true);
			if (f == "5rX") data.i = $scope.decode_x(data.x);
			if (f == "X5r") {
				data.s = data.r;
				data.r = $scope.decode_x(data.x);
			}
			if (f == "5r6s") {
				var temp = data.r;
				data.r = data.s;
				data.s = temp;
			}
			for (var mnemonic in $scope.instructions) {
				inst = $scope.instructions[mnemonic];
				if (inst.format == f && inst.c == data.c) {
					return new $scope.instruction(x, mnemonic, data, inst.exec, addr);
				}
			}
		}
		return {
			"error": "Could not decode instruction: " + x
		};
	}
	$scope.label = function(name, addr) {
		this.label = true;
		this.name = name;
		this.addr = addr;
	}
	$scope.output_mux = function() {
		this.SEL_ADDR = 0;
		this.SEL_LEN = 1;
		this.SEL_TARGET = 2;

		this.target = 0;
		this.len = 0;
		this.state = 0;
		var self = this;
		this.input = function(val) {
			$scope.debug_log("MUX", val, self.state, self.target, self.len);
			if (self.state == self.SEL_ADDR) {
				self.target = val;
				self.state = self.SEL_LEN;
			} else if (self.state == self.SEL_LEN) {
				self.len = val;
				self.state = self.target;
				self.target = 0;
				self.state = self.SEL_TARGET;
			} else if (self.state == self.SEL_TARGET) {
				if (self.len > 0) {
					if (self.target < $scope.output_devs.length)
						$scope.output_devs[self.target].input(val);
					self.len--;
				}
				if (self.len == 0) {
					self.state = self.SEL_ADDR;
				}
			}
			$scope.debug_log("MUX_end", val, self.state, self.target, self.len);
		}
	}
	$scope.char_display = function() {
		this.cursor_x = 0;
		this.cursor_y = 0;
		this.chars = [
			["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
			["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
			["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
			["", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]
		];
		this.state = "BASE";
		var self = this;
		this.input = function(val) {
			console.log("CHAR", val);
			if (self.state == "BASE") {
				if (val != 0x1b) {
					self.chars[self.cursor_y][self.cursor_x] = String.fromCharCode(val);
				} else {
					self.state = "ESC";
				}
			} else if (self.state == "ESC") {
				if (val == 67) {
					self.cursor_x++;
					if (self.cursor_x == 16) {
						self.cursor_x = 0;
						self.cursor_y++;
						if (self.cursor_y == 4) self.cursor_y = 0;
					}
					self.state = "BASE";
				} else if (val == 68) {
					self.cursor_x--;
					if (self.cursor_x == -1) {
						self.cursor_x = 15;
						self.cursor_y--;
						if (self.cursor_y == -1) self.cursor_y = 3;
					}
					self.state = "BASE";
				} else if (val == 72) {
					self.state = "CURSORX";
				} else self.state = "BASE";
			} else if (self.state == "CURSORX") {
				self.cursor_x = $scope.truncate(val, 4, false);
				self.state = "CURSORY"
			} else if (self.state == "CURSORY") {
				self.cursor_y = $scope.truncate(val, 2, false);
				self.state = "BASE";
			}
		}
	}
	$scope.set_PM_display_mode = function(m) {
		$scope.PM_display_mode = m;
	}
	$scope.set_RAM_display_mode = function(m) {
		$scope.RAM_display_mode = m;
	}
	$scope.set_RF_display_mode = function(m) {
		$scope.RF_display_mode = m;
	}
	$scope.instruction = function(text, mnemonic, data, exec, addr) {
		thislabel = false;
		this.addr = addr;
		this.text = text;
		this.c = data.c;
		this.r = data.r;
		this.s = data.s;
		this.i = data.i;
		this.exec = exec;
		this.mnemonic = mnemonic;
		$scope.debug_log(this.text, this.c, this.r, this.s, this.i, this.mnemonic);
		this.format = $scope.instructions[this.mnemonic].format;
		if (this.i.match) {
			matches = this.i.match(/(lo|hi)8\(([a-zA-Z_][a-zA-Z0-9_]*)\)/);
			if (matches) {
				if (matches[2] in $scope.symbols) {
					if (matches[1] == "lo") this.i = $scope.truncate($scope.symbols[matches[2]], 8, false);
					if (matches[1] == "hi") this.i = $scope.truncate($scope.symbols[matches[2]] >> 8, 8, false);
				} else {
					this.error = "Symbol not found " + matches[2];
				}
			} else if (this.i in $scope.symbols) {
				this.i = $scope.symbols[this.i];
				var fmt = $scope.formats[this.format];
				$scope.debug_log($scope.symbols, fmt.i_bits);
				if (fmt.i_bits) {
					this.i = $scope.truncate(this.i - this.addr - 1, fmt.i_bits, true);
				}
			} else if (/'[^'\\]'/.test(this.i)) {
				this.i = this.i.charCodeAt(1);
			} else if (this.i == "'\\''") {
				this.i = this.i.charCodeAt(2);
			} else if (this.i == "'\\\\'") {
				this.i = this.i.charCodeAt(2);
			} else if (this.i == "'\\n'") {
				this.i = 10;
			} else if (this.i == "'\\t'") {
				this.i = 9;
			} else if (/^[XYZ]$|^[XYZ]\+$|^-[XYZ]$/.test(this.i)) {
				this.i = this.i;
			} else this.i = parseInt(this.i);
		}
		this.encoding = $scope.encode(this.format, this.c, this.r, this.s, this.i < 0 ? $scope.truncate(this.i, $scope.formats[this.format].i_bits, false) : this.i);
		$scope.debug_log(this.text, this.c, this.r, this.s, this.i, this.mnemonic);
		var self = this;
		this.display = function() {
			if ($scope.PM_display_mode == "t") {
				return $scope.formats[self.format].to_string(self.mnemonic, self.c, self.r, self.s, self.i);
			} else if ($scope.PM_display_mode == "d") {
				return self.encoding;
			} else if ($scope.PM_display_mode == "h") {
				var s = self.encoding.toString(16);
				return "0x" + smul("0", 4 - s.length) + s;
			} else if ($scope.PM_display_mode == "b") {
				var s = self.encoding.toString(2);
				return smul("0", 16 - s.length) + s;
			}
		}
		this.check_valid = function() {
			return $scope.formats[self.format].validator(self.c, self.r, self.s, self.i);
		}
		this.run = function() {
			self.exec(self.c, self.r, self.s, self.i);
		}
	}

	function smul(str, num) {
		var acc = [];
		for (var i = 0;
			(1 << i) <= num; i++) {
			if ((1 << i) & num)
				acc.push(str);
			str += str;
		}
		return acc.join("");
	}
	$scope.step = function() {
		if (!$scope.running) return;
		$scope.debug_log($scope.steps.count);
		for (var k = 0; k < $scope.steps.count; k++) {
			var i = $scope.PM[$scope.PC];
			$scope.debug_log("i", i);
			i.run();
			if ($scope.PC < $scope.display_pm_start || $scope.PC >= $scope.display_pm_start + $scope.display_pm_length) {
				$scope.display_pm_start = Math.max(0, $scope.PC - $scope.display_ram_length / 2);
			}
			if ($scope.ram_updated.length > 0) {
				$scope.display_ram_start = Math.max(0, Math.min.apply(Math, $scope.ram_updated) - $scope.display_ram_length / 2);
			}
			$scope.handle_output();
		}
	}
	$scope.handle_output = function() {
		var d = $scope.truncate($scope.PORTD, 8, false);
		var val = d & 127;
		var state = d >> 7;
		$scope.debug_log("oUT", val, state, $scope.output_state);
		if ($scope.output_state == "RESET" && state == 0) {
			$scope.output_state = "READY";
		} else if ($scope.output_state == "READY" && state == 1) {
			$scope.output_state = "RESET";
			$scope.mux.input(val);
		}
	}
	$scope.raise_error = function(s) {
			$scope.status = "Error: " + s;
		}
		// takes number, shifts by 
	$scope.truncate = function(num, bits, twos_complement) {
		var mod = 1 << bits;
		num = ((num % mod) + mod) % mod;
		return twos_complement ? (num >= 1 << (bits - 1) ? num - (1 << bits) : num) : num;
	}
	$scope.update_sreg = function(result, z, c, n) {
		$scope.debug_log("SREG for", result);
		if (z) $scope.Z = $scope.truncate(result, 8, false) == 0 ? 1 : 0;
		if (c) $scope.C = result >= 256 || result < 0 ? 1 : 0;
		if (n) $scope.N = $scope.truncate(result, 8, true) < 0 ? 1 : 0;
	}
	$scope.read_IO = function(s) {
		if (s == 16) return $scope.PIND & (~($scope.DDRD));
		else if (s == 17) return $scope.DDRD;
		else if (s == 61) return $scope.SPL;
		else if (s == 62) return $scope.SPH;
		return 0;
	}
	$scope.write_IO = function(s, val) {
		if (s == 18) {
			$scope.PORTD = $scope.DDRD & val;
			$scope.output();
		} else if (s == 17) $scope.DDRD = $scope.truncate(val, 8, false);
		else if (s == 61) $scope.SPL = $scope.truncate(val, 8, false);
		else if (s == 62) $scope.SPH = $scope.truncate(val, 8, false);
		if ($scope.output_type.selection == "simple") {
			$scope.PIND = 0;
			for (var i = 0; i < 8; i++)
				$scope.PIND |= ($scope.io_state.switch_state[i] == "ON" ? 1 << i : 0)
			$scope.PIND &= ~$scope.DDRD;
		}
	}
	$scope.inc_ptr = function(reg) {
		if ($scope.RF[reg] == -1 || $scope.RF[reg] == 255) {
			$scope.RF[reg] = 0
			$scope.RF[reg + 1] = $scope.truncate($scope.RF[reg + 1] + 1, 8, false);
		} else $scope.RF[reg]++;
		if ($scope.RF[reg] == 128) {
			$scope.RF[reg] = -128;
		}
	}
	$scope.dec_ptr = function(reg) {
		$scope.RF[reg]--;
		if ($scope.RF[reg] == -1) {
			$scope.RF[reg + 1] = $scope.truncate($scope.RF[reg + 1] - 1, 8, false);
		}
		if ($scope.RF[reg] < -128) {
			$scope.RF[reg] = 127;
		}
	}
	$scope.incSP = function() {
		$scope.SPL++;
		if ($scope.SPL == 256) {
			$scope.SPL = 0;
			$scope.SPH = $scope.truncate($scope.SPH + 1, 8, false);
		}
	}
	$scope.decSP = function() {
		$scope.SPL--;
		if ($scope.SPL == -1) {
			$scope.SPL = 255;
			$scope.SPH = $scope.truncate($scope.SPH - 1, 8, false);
		}
	}
	$scope.instructions = {
		/*
    	see http://www.atmel.com/webdoc/avrassembler for more information
		format: 				opcode structure
		c: 						opcode decimal equivalent of binary value
		exec: 					dunno
		$scope.[singleletter]:  flag
	*/
		"adc": {
			"format": "5r5s",
			"c": 7,
			"exec": function(c, r, s, i) {
				var oldC = $scope.C;
				$scope.update_sreg($scope.RF[r] + $scope.RF[s] + oldC, true, true, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] + $scope.RF[s] + oldC, 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC", "Z", "C", "N"];
			}
		},
		"add": {
			"format": "5r5s",
			"c": 3,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] + $scope.RF[s], true, true, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] + $scope.RF[s], 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC", "Z", "C", "N"];
			}
		},
		"adiw": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"and": {
			"format": "5r5s",
			"c": 8,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] & $scope.RF[s], true, false, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] & $scope.RF[s], 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC", "Z", "C", "N"];
			}
		},
		"andi": {
			"format": "4r8i",
			"c": 7,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] & i, true, false, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] & i, 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = ["PC", "Z", "C", "N"];
			}
		},
		"asr": {
			"format": "5r",
			"c": 1189,
			"exec": function(c, r, s, i) {
				var C = $scope.RF[r] % 2 == 0 ? 0 : 1;
				$scope.RF[r] = $scope.truncate($scope.truncate($scope.RF[r], 8, true) >> 1, 8, false);
				$scope.update_sreg($scope.RF[r], true, false, true);
				$scope.C = C;
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC"];
			}
		},
		"bclr": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"bld": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"brbc": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"brbs": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"brcc": {
			"format": "7i",
			"c": 488,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.C == 0 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brcs": {
			"format": "7i",
			"c": 480,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.C == 1 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"break": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"breq": {
			"format": "7i",
			"c": 481,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.Z == 1 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brge": {
			"format": "7i",
			"c": 492,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + (($scope.N ? $scope.V : !$scope.V) ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brhc": {
			"format": "7i",
			"c": 493,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.H == 0 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brhs": {
			"format": "7i",
			"c": 485,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.H == 1 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brid": {
			"format": "7i",
			"c": 495,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.I == 0 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brie": {
			"format": "7i",
			"c": 487,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.I == 1 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brlo": {
			"format": "7i",
			"c": 480,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.C == 1 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brlt": {
			"format": "7i",
			"c": 484,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + (($scope.N ? !$scope.V : $scope.V) ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brmi": {
			"format": "7i",
			"c": 482,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.N == 1 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brne": {
			"format": "7i",
			"c": 489,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.Z == 0 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brpl": {
			"format": "7i",
			"c": 490,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.N == 0 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brsh": {
			"format": "7i",
			"c": 488,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.C == 0 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brtc": {
			"format": "7i",
			"c": 494,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.T == 0 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brts": {
			"format": "7i",
			"c": 486,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.T == 1 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brvc": {
			"format": "7i",
			"c": 491,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.V == 0 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"brvs": {
			"format": "7i",
			"c": 483,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + 1 + ($scope.V == 1 ? (i <= 64 ? i : i - 128) : 0), 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"bset": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"bst": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"call": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"cbi": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"cbr": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"clc": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"clh": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"cli": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"cln": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"clr": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"cls": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"clt": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"clv": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"clz": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"com": {
			"format": "5r",
			"c": 1184,
			"exec": function(c, r, s, i) {
				$scope.update_sreg(~($scope.RF[r]), true, false, true);
				$scope.RF[r] = $scope.truncate(~($scope.RF[r]), 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC"];
			}
		},
		"cp": {
			"format": "5r5s",
			"c": 5,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] - $scope.RF[s], true, true, true);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = ["PC", "Z", "C", "N"];
			}
		},
		"cpc": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"cpi": {
			"format": "4r8i",
			"c": 3,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] - i, true, true, true);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = ["PC", "Z", "C", "N"];
			}
		},
		"cpse": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"dec": {
			"format": "5r",
			"c": 1194,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] - 1, true, false, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] - 1, 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC"];
			}
		},
		"eicall": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"iejmp": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"elpm": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"eor": {
			"format": "5r5s",
			"c": 9,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] ^ $scope.RF[s], true, false, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] ^ $scope.RF[s], 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC", "Z", "C", "N"];
			}
		},
		"fmul": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"fmuls": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"fmulsu": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"halt": {
			"format": "n",
			"c": 1,
			"exec": function(c, r, s, i) { // NOT AN ACTUAL AVR INSTRUCTION
				$scope.end();
			}
		},
		"icall": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"ijmp": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"in": {
			"format": "6s5r",
			"c": 22,
			"exec": function(c, r, s, i) {
				$scope.RF[r] = $scope.truncate($scope.read_IO(s), 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC"];
			}
		},
		"inc": {
			"format": "5r",
			"c": 1187,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] + 1, true, false, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] + 1, 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC"];
			}
		},
		"jmp": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"lat": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"las": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"lac": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"ld": {
			"format": "5rX",
			"c": 32,
			"exec": function(c, r, s, i) {
				var reg = 0;
				if (i == "X" || i == "-X" || i == "X+") reg = 26;
				if (i == "Y" || i == "-Y" || i == "Y+") reg = 28;
				if (i == "Z" || i == "-Z" || i == "Z+") reg = 30;
				if (i[0] == "-") {
					$scope.updated.push(reg);
					$scope.dec_ptr(reg);
				}
				var ptr = $scope.truncate($scope.RF[reg], 8, false) + 256 * $scope.truncate($scope.RF[reg + 1], 8, false);
				$scope.updated = [r, "PC"];
				$scope.RF[r] = $scope.truncate($scope.RAM[ptr], 8, false);
				if (i[1] == "+") {
					$scope.updated.push(reg);
					$scope.inc_ptr(reg);
				}
				$scope.ram_updated = [];
				$scope.PC++;
			}
		},
		"ldi": {
			"format": "4r8i",
			"c": 14,
			"exec": function(c, r, s, i) {
				$scope.RF[r] = $scope.truncate(i, 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC"];
			}
		},
		"lds": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"lpm": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"lsl": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"lsr": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"mov": {
			"format": "5r5s",
			"c": 11,
			"exec": function(c, r, s, i) {
				$scope.RF[r] = $scope.RF[s];
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC"];
			}
		},
		"movw": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"mul": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"muls": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"mulsu": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"neg": {
			"format": "5r",
			"c": 1185,
			"exec": function(c, r, s, i) {
				$scope.update_sreg(-$scope.RF[r], true, true, true);
				$scope.RF[r] = $scope.truncate(-$scope.RF[r], 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC"];
			}
		},
		"nop": {
			"format": "n",
			"c": 0,
			"exec": function(c, r, s, i) {
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"or": {
			"format": "5r5s",
			"c": 10,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] | $scope.RF[s], true, false, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] | $scope.RF[s], 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC", "Z", "C", "N"];
			}
		},
		"ori": {
			"format": "4r8i",
			"c": 6,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] | i, true, false, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] | i, 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = ["PC", "Z", "C", "N"];
			}
		},
		"out": {
			"format": "5r6s",
			"c": 23,
			"exec": function(c, r, s, i) {
				i = s;
				s = r;
				r = i;
				$scope.write_IO(s, $scope.RF[r]);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"pop": {
			"format": "5r",
			"c": 1167,
			"exec": function(c, r, s, i) {
				$scope.incSP();
				var SP = $scope.SPH * 256 + $scope.SPL;
				$scope.RF[r] = $scope.truncate($scope.RAM[SP], 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = ["PC", "SPH", "SPL"];
			}
		},
		"push": {
			"format": "5r",
			"c": 1183,
			"exec": function(c, r, s, i) {
				var SP = $scope.SPH * 256 + $scope.SPL;
				$scope.RAM[SP] = $scope.RF[r];
				$scope.decSP();
				$scope.PC++;
				$scope.updated = ["PC", "SPH", "SPL"];
				$scope.ram_updated = [SP];
			}
		},
		"rcall": {
			"format": "12i",
			"c": 13,
			"exec": function(c, r, s, i) {
				$scope.PC++;
				var PCL = $scope.PC % 256;
				var PCH = Math.floor($scope.PC / 256);
				var SP = $scope.SPH * 256 + $scope.SPL;
				$scope.RAM[SP] = PCH;
				$scope.decSP();
				var SP = $scope.SPH * 256 + $scope.SPL;
				$scope.RAM[SP] = PCL;
				$scope.decSP();
				$scope.PC = $scope.truncate($scope.PC + i, 16, false);
				$scope.updated = ["PC", "SPH", "SPL"];
				$scope.ram_updated = [SP];
			}
		},
		"ret": {
			"format": "n",
			"c": 38152,
			"exec": function(c, r, s, i) {
				$scope.incSP();
				var SP = $scope.SPH * 256 + $scope.SPL;
				var PCL = $scope.RAM[SP];
				$scope.incSP();
				var SP = $scope.SPH * 256 + $scope.SPL;
				var PCH = $scope.RAM[SP];
				$scope.PC = PCL + 256 * PCH;
				$scope.ram_updated = [];
				$scope.updated = ["PC", "SPH", "SPL"];
			}
		},
		"reti": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"rjmp": {
			"format": "12i",
			"c": 12,
			"exec": function(c, r, s, i) {
				$scope.PC = $scope.truncate($scope.PC + i + 1, 16, false);
				$scope.ram_updated = [];
				$scope.updated = ["PC"];
			}
		},
		"rol": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"ror": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sbc": {
			"format": "5r5s",
			"c": 2,
			"exec": function(c, r, s, i) {
				var oldC = $scope.C;
				$scope.update_sreg($scope.RF[r] - $scope.RF[s] - oldC, true, true, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] - $scope.RF[s] - oldC, 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC", "Z", "C", "N"];
			}
		},
		"sbci": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sbi": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sbic": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sbis": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sbiw": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sbr": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sbrc": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sec": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"seh": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sei": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sen": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"ser": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"ses": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"set": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sev": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sez": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sleep": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"spm": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"st": {
			"format": "X5r",
			"c": 33,
			"exec": function(c, r, s, i) {
				i = r;
				r = s;
				var reg = 0;
				if (i == "X" || i == "-X" || i == "X+") reg = 26;
				if (i == "Y" || i == "-Y" || i == "Y+") reg = 28;
				if (i == "Z" || i == "-Z" || i == "Z+") reg = 30;
				if (i[0] == "-") {
					$scope.updated.push(reg);
					$scope.dec_ptr(reg);
				}
				var ptr = $scope.truncate($scope.RF[reg], 8, false) + 256 * $scope.truncate($scope.RF[reg + 1], 8, false);
				$scope.updated = ["PC"];
				$scope.ram_updated = [ptr];
				$scope.RAM[ptr] = $scope.RF[r];
				$scope.PC++;
				if (i[1] == "+") {
					$scope.updated.push(reg);
					$scope.inc_ptr(reg);
				}
			}
		},
		"sts": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"sub": {
			"format": "5r5s",
			"c": 6,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] - $scope.RF[s], true, true, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] - $scope.RF[s], 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = [r, "PC", "Z", "C", "N"];
			}
		},
		"subi": {
			"format": "4r8i",
			"c": 5,
			"exec": function(c, r, s, i) {
				$scope.update_sreg($scope.RF[r] - i, true, true, true);
				$scope.RF[r] = $scope.truncate($scope.RF[r] - i, 8, false);
				$scope.PC++;
				$scope.ram_updated = [];
				$scope.updated = ["PC", "Z", "C", "N"];
			}
		},
		"swap": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"tst": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"wdr": {}, // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
		"xch": {} // UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPDATE THIS UPADATE THIS
	};
	$scope.io_switch = function(i) {
		if ($scope.io_state.switch_state[i] == "ON") {
			$scope.io_state.switch_state[i] = "OFF";
			$scope.PIND &= ~(1 << i);
		} else if ($scope.io_state.switch_state[i] == "OFF") {
			$scope.io_state.switch_state[i] = "ON";
			$scope.PIND |= 1 << i;
		}
		$scope.PIND = $scope.PIND & ~$scope.DDRD;
	}
	$scope.output = function() {
		var out_val = $scope.PORTD;
		$scope.outputs.push(out_val);
		//$scope.outputs.push(String.fromCharCode(out_val));
	}
	$scope.initialize = function() {
		$scope.reset_program();
		$scope.cm_setup();
	}
	$scope.end = function() {
		if (!$scope.running) return;
		$scope.running = false;
		setTimeout($scope.cm_setup, 0);
	}
	$scope.reset(true);
	$scope.original_program = $scope.program;
	setTimeout($scope.initialize, 0);
})
.directive('simAvr', function() {
	return {
		restrict: 'E',
		scope: {
			program: '=program',
			text: '=',
			control: '=',
			size: '@size',
			lightboard_feature: '@lightboard',
			reset_feature: '@reset',
			simid: '@simid',
			debug_mode_feature: '@debug'
		},
		templateUrl: function(element, attrs) {
			return attrs.template;
		},
		controller: 'AvrSimController',
		link: function(scope, element, attrs) {
			scope.debug_log = scope.debug_mode_feature == 'yes' ? console.log.bind(console) : scope.do_nothing;
			if (scope.control) {
				scope.control.set_program = function(new_prog) {
					scope.change_program(new_prog);
				}
				scope.control.get_program = function() {
					if (scope.editor) scope.program = scope.editor.getValue();
					return scope.program;
				}
				scope.control.get_PM = function(addr) {
					return scope.PM[addr].encoding;
				}
				scope.control.get_RF = function() {
					return scope.RF;
				}
				scope.control.get_RAM = function(addr) {
					return scope.RAM[addr];
				}
				scope.control.get_other = function() {
					return {
						"PC": scope.PC,
						"Z": scope.Z,
						"C": scope.C,
						"N": scope.N,
						"DDRD": scope.DDRD,
						"PIND": scope.PIND,
						"PORTD": scope.PORTD,
						"SPL": scope.SPL,
						"SPH": scope.SPH
					}
				}
				if (scope.control.linked) scope.control.linked();
				else scope.$emit("jsavr_linked");
			}
		}
	}
});