CREATE TABLE `tiles` (
                         `short_code` varchar(256) NOT NULL,
                         `parent` varchar(256) NOT NULL,
                         `level` int NOT NULL,
                         `folder` varchar(256) NOT NULL,
                         `bounds_left` double NOT NULL,
                         `bounds_top` double NOT NULL,
                         `bounds_right` double NOT NULL,
                         `bounds_bottom` double NOT NULL,
                         PRIMARY KEY (`short_code`),
                         UNIQUE KEY `short_code_UNIQUE` (`short_code`),
                         KEY `level` (`level`) /*!80000 INVISIBLE */,
                         KEY `bounds_left` (`bounds_left`) /*!80000 INVISIBLE */,
                         KEY `bounds_right` (`bounds_right`) /*!80000 INVISIBLE */,
                         KEY `bounds_top` (`bounds_top`) /*!80000 INVISIBLE */,
                         KEY `bounds_bottom` (`bounds_bottom`),
                         KEY `folder` (`folder`)
) ENGINE=InnoDB DEFAULT CHARSET=latin1;
